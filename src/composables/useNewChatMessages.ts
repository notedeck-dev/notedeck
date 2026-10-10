import type { UnlistenFn } from '@tauri-apps/api/event'
import { onScopeDispose, watch as vueWatch } from 'vue'
import type { ChatMessage } from '@/adapters/types'
import { events } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * 別の会話に来たチャットの新着を受ける (チャットの履歴一覧用)。
 *
 * 本家は会話のチャンネル (chatUser / chatRoom) を開いていない会話の新着を
 * main チャンネルの `newChatMessage` で流す (受信から 3 秒たっても既読に
 * ならなかったものだけ)。main はアカウント単位の共有チャンネルで外す口が無い
 * (#984) ので、`watch` は張るだけで、止めるのは受信側の購読だけ。
 *
 * ここで張る main はチャットの新着だけを受け、通知などは配らない (チャットを
 * 開いただけで OS 通知が出ないように)。ポーリングのアカウントでは notecli が
 * chat/history を周期で取って同じ新着を作る (#1223)
 */
export function useNewChatMessages(
  onMessage: (accountId: string, message: ChatMessage) => void,
) {
  let unlisten: UnlistenFn | null = null
  let disposed = false

  try {
    events.streamNewChatMessage
      .listen(({ payload }) =>
        onMessage(payload.accountId, payload.message as unknown as ChatMessage),
      )
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
      .catch(() => {
        // Tauri 外 (pnpm dev のブラウザ確認・テスト) では購読できない
      })
  } catch {
    // 同上
  }

  /** アカウントの main チャンネルを張る */
  function watch(accountIds: string[]) {
    for (const id of accountIds) {
      commands
        .streamSubscribeMain(id)
        .then(unwrap)
        .catch(() => {
          // 張れなくても、次に履歴を取り直したときに追いつく
        })
    }
  }

  /**
   * アカウントの一覧に追随して main を張る (全アカウントのカラム用、#1223)。
   * 後から増えたアカウントにも張り、外れてから戻ったもの (再ログイン等) は張り直す
   */
  function follow(getAccountIds: () => string[]) {
    let followed = new Set<string>()
    vueWatch(
      getAccountIds,
      (ids) => {
        watch(ids.filter((id) => !followed.has(id)))
        followed = new Set(ids)
      },
      { immediate: true },
    )
  }

  onScopeDispose(() => {
    disposed = true
    unlisten?.()
    unlisten = null
  })

  return { watch, follow }
}

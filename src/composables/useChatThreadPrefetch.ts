/**
 * チャット履歴 thread の同期ジョブ (#460 Phase B-6 + B-4)。
 *
 * Misskey `chat/history` API は各 thread の最新 1 件しか返さない仕様のため、
 * history view を表示しただけでは「ユーザーが過去に開いたことのある thread」
 * 以外は最新 1 件しか cache に蓄積されない。さらに WS 切断中に届いた
 * メッセージは sync token がないため自動的に取り戻せない。
 *
 * 本 composable は history view を表示したタイミングで各 thread を
 * 状況に応じて埋める。`chat.cacheEnabled = false` のときは全 skip。
 *
 * | DB の状態 | 動作 |
 * |---|---|
 * | 0-1 件 (履歴未取得) | `untilId` pagination で **全件**取得 (B-6) |
 * | 2 件以上 (履歴取得済) | `sinceId` で **新着差分**取得 (B-4) |
 *
 * これにより各 thread は常に「過去全件 + WS 切断中の差分」がローカルに
 * 揃い、ログアウト/オフライン時でも完全な履歴が読めるようになる。
 */
import type { ChatMessage } from '@/adapters/types'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { useSettingsStore } from '@/stores/settings'
import { commands, unwrap } from '@/utils/tauriInvoke'

export interface PrefetchTarget {
  accountId: string
  isRoom: boolean
  /** isRoom=true なら roomId, false なら other userId */
  targetId: string
}

/** 1 page あたりの fetch 件数 (Misskey 推奨上限)。 */
const PAGE_SIZE = 100
/** 並列度 (sliding window)。 */
const PREFETCH_CONCURRENCY = 3
/** 1 thread あたり最大 page 数 (= 100 × 100 = 10,000 件で打ち切り)。 */
const MAX_PAGES_PER_THREAD = 100
/**
 * DB にこの件数以上ある thread は「履歴取得済」と判断し、
 * 全件 prefetch ではなく `sinceId` 差分 reconcile に切り替える。
 */
const HAS_HISTORY_AT_LEAST = 2
/**
 * sinceId 差分 reconcile で 1 回に取る上限。WS 切断が長期な場合でも
 * これで取り切れない分は次回起動時の reconcile で順次埋める。
 */
const SINCE_RECONCILE_LIMIT = 100

export function useChatThreadPrefetch() {
  const settingsStore = useSettingsStore()
  const multiAdapters = useMultiAccountAdapters()

  /** 履歴未取得 thread (DB 0-1 件) を `untilId` pagination で全件取得する。 */
  async function fullPrefetch(
    target: PrefetchTarget,
    adapter: Awaited<ReturnType<typeof multiAdapters.getOrCreate>>,
  ): Promise<void> {
    if (!adapter) return
    // Misskey API は created_at 降順で返すので、配列末尾 (= 最古 message) の
    // id を次の untilId にする。空配列 / PAGE_SIZE 未満 / 同じ untilId の
    // 繰り返し / 上限 page 数 で打ち切り。
    let untilId: string | undefined
    for (let page = 0; page < MAX_PAGES_PER_THREAD; page++) {
      const fetched: ChatMessage[] = target.isRoom
        ? await adapter.api.getChatRoomMessages(target.targetId, {
            limit: PAGE_SIZE,
            untilId,
            cache: true,
          })
        : await adapter.api.getChatUserMessages(target.targetId, {
            limit: PAGE_SIZE,
            untilId,
            cache: true,
          })

      if (fetched.length === 0) break
      const oldest: ChatMessage | undefined = fetched[fetched.length - 1]
      if (!oldest) break
      if (oldest.id === untilId) break
      untilId = oldest.id
      if (fetched.length < PAGE_SIZE) break
    }
  }

  /**
   * 履歴取得済 thread (DB 2 件以上) の WS 切断中差分を `sinceId` で取り戻す。
   * Misskey は sync token がないため、起動時にこれを呼んで gap を埋める。
   * `cache=true` で透過的に DB に upsert される。
   */
  async function sinceReconcile(
    target: PrefetchTarget,
    adapter: Awaited<ReturnType<typeof multiAdapters.getOrCreate>>,
    threadId: string,
  ): Promise<void> {
    if (!adapter) return
    const latestId = unwrap(
      await commands.apiGetCachedChatLatestMessageId(
        target.accountId,
        threadId,
      ),
    )
    if (!latestId) return // 履歴があるはずだが安全側で no-op

    if (target.isRoom) {
      await adapter.api.getChatRoomMessages(target.targetId, {
        limit: SINCE_RECONCILE_LIMIT,
        sinceId: latestId,
        cache: true,
      })
    } else {
      await adapter.api.getChatUserMessages(target.targetId, {
        limit: SINCE_RECONCILE_LIMIT,
        sinceId: latestId,
        cache: true,
      })
    }
  }

  async function syncOne(target: PrefetchTarget): Promise<void> {
    const threadId = target.isRoom
      ? `r:${target.targetId}`
      : `u:${target.targetId}`
    try {
      const cached = unwrap(
        await commands.apiGetCachedChatThreadMessages(
          target.accountId,
          threadId,
          null,
          HAS_HISTORY_AT_LEAST,
        ),
      )
      const adapter = await multiAdapters.getOrCreate(target.accountId)
      if (!adapter) return

      if (cached.length >= HAS_HISTORY_AT_LEAST) {
        await sinceReconcile(target, adapter, threadId)
      } else {
        await fullPrefetch(target, adapter)
      }
    } catch {
      // best-effort。trace ログも残さない (大量 thread で雑音になる)。
    }
  }

  /**
   * targets を並列度 PREFETCH_CONCURRENCY で sliding-window 実行する。
   * 全部の同期が完了するまで resolve しないが、呼び出し側は
   * await せずに fire-and-forget で良い。
   */
  async function prefetch(targets: PrefetchTarget[]): Promise<void> {
    if (settingsStore.get('chat.cacheEnabled') === false) return
    if (targets.length === 0) return

    const queue = targets.slice()
    const workers = Array.from(
      { length: Math.min(PREFETCH_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          const next = queue.shift()
          if (next) await syncOne(next)
        }
      },
    )
    await Promise.all(workers)
  }

  return { prefetch }
}

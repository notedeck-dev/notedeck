import { events } from '@/bindings'
import type { useChatMessageStore } from '@/stores/chatMessageStore'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * チャットのリアクション WS イベント (#781 Phase 2 の typed event) を
 * chatMessageStore に流す (#460 B-3)。applyUpdate は (受信アカウント,
 * message id) で当てるので別サーバーの同じ ID には作用しない (#1270)。
 * 戻りは購読解除
 */
export async function listenChatReactionEvents(
  store: ReturnType<typeof useChatMessageStore>,
): Promise<() => void> {
  const reacted = await events.streamChatMessageReacted.listen(
    ({ payload: { accountId, messageId, reaction, user } }) => {
      store.applyUpdate({
        type: 'reacted',
        accountId,
        messageId,
        userId: user?.id ?? null,
        reaction,
        reactor: user ?? null,
      })
    },
  )
  const unreacted = await events.streamChatMessageUnreacted.listen(
    ({ payload: { accountId, messageId, reaction, user } }) => {
      store.applyUpdate({
        type: 'unreacted',
        accountId,
        messageId,
        userId: user?.id ?? null,
        reaction,
        reactor: user ?? null,
      })
    },
  )
  return () => {
    reacted()
    unreacted()
  }
}

/** 開いている会話の既読位置をストリーム側に伝える */
export function markChatRead(
  accountId: string,
  subscriptionId: string,
  messageId: string,
): Promise<void> {
  return commands
    .streamChatRead(accountId, subscriptionId, messageId)
    .then((r) => {
      unwrap(r)
    })
}

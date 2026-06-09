import type { ChatMessage } from '@/adapters/types'
import { useMuteStore } from '@/stores/mutes'

/**
 * チャットの表示可視性述語。[[useNoteVisibility]] のチャット版。
 *
 * 本家 (Misskey/yamisskey) はチャットを block ベースで設計しており muting を
 * 適用しない（DM/通知は muting するのに非対称）。NoteDeck は「ミュート＝存在を
 * 無視する」方針を貫くため、チャットでも独自にミュートユーザーを隠す（#575）。
 *
 * ChatMessage は `_accountId` を持たないため、判定は account 文脈を持つ
 * 呼び出し側（DeckChatColumn の per-account / cross-account 履歴）から
 * accountId を渡す。room の個別発言は isMessageHidden、DM 相手単位の
 * 履歴除外は isPartnerMuted で扱う。
 */
export function useChatVisibility() {
  const muteStore = useMuteStore()

  /** DM 相手がミュート済みか（room には適用しない＝呼び出し側で !isRoom ガード） */
  function isPartnerMuted(
    accountId: string | null | undefined,
    otherId: string | null | undefined,
  ): boolean {
    if (!accountId) return false
    return muteStore.isMuted(accountId, otherId)
  }

  /** メッセージ送信者がミュート済みか（room 内の個別発言にも適用） */
  function isMessageHidden(
    accountId: string | null | undefined,
    msg: ChatMessage,
  ): boolean {
    if (!accountId) return false
    return muteStore.isMuted(accountId, msg.fromUserId)
  }

  return { isPartnerMuted, isMessageHidden }
}

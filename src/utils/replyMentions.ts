import type { NormalizedNote } from '@/adapters/types'
import { parseMfm } from '@/utils/mfm'

/**
 * リプライ開始時に投稿フォームへ prefill するメンション列を組み立てる (#707)。
 * Misskey WebUI と同じく「リプライ先ユーザー + リプライ先本文中のメンション
 * (= 会話参加者)」を、自分を除外しつつ重複なしで引き継ぐ。
 */
export function buildReplyMentions(
  replyTo: NormalizedNote,
  me: {
    userId?: string | null
    username?: string | null
    host?: string | null
  } | null,
): string[] {
  const mentions: string[] = []
  const seen = new Set<string>()

  // 1. Reply target user
  const replyUser = replyTo.user
  if (replyUser.id !== me?.userId) {
    const acct = replyUser.host
      ? `@${replyUser.username}@${replyUser.host}`
      : `@${replyUser.username}`
    mentions.push(acct)
    seen.add(acct.toLowerCase())
  }

  // 2. Mentions in the reply target's text (reply chain participants)
  if (replyTo.text) {
    for (const token of parseMfm(replyTo.text)) {
      if (token.type !== 'mention') continue
      const acct = token.acct
      const lower = acct.toLowerCase()
      if (seen.has(lower)) continue
      // Skip self
      const isSelf = token.host
        ? token.username.toLowerCase() === me?.username?.toLowerCase() &&
          token.host.toLowerCase() === me?.host?.toLowerCase()
        : token.username.toLowerCase() === me?.username?.toLowerCase()
      if (isSelf) continue
      seen.add(lower)
      mentions.push(acct)
    }
  }

  return mentions
}

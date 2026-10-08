import type { AvatarDecoration, ChatMessage, ChatUser } from '@/adapters/types'
import type { PrefetchTarget } from '@/composables/useChatThreadPrefetch'

/**
 * チャット履歴 view の thread entry 構築ロジック (#707)。
 * DeckChatColumn から抽出した純関数群。cross-account / per-account の
 * history entry 導出と検索マッチをここに集約する。
 */

interface ChatHistoryEntryBase {
  key: string
  message: ChatMessage
  isRoom: boolean
  name: string
  /** 表示名 (`name`) が user-defined か (false なら fallback の username/roomId を使用)。 */
  hasName: boolean
  /** name に含まれる `:shortcode:` を画像に解決するための辞書。 */
  emojis?: Record<string, string>
  avatarUrl?: string
  avatarDecorations?: AvatarDecoration[]
  otherId?: string
}

export interface CrossAccountChatHistoryEntry extends ChatHistoryEntryBase {
  accountId: string
  serverHost: string
  roomId?: string
}

export type PerAccountChatHistoryEntry = ChatHistoryEntryBase

/** DM の相手 user を導出する (自分発信なら toUser、受信なら fromUser)。 */
function resolveOther(
  msg: ChatMessage,
  myUserId: string | undefined,
): { otherId: string | undefined; other: ChatUser | undefined } {
  const isMine = msg.fromUserId === myUserId
  return {
    otherId: isMine ? msg.toUserId : msg.fromUserId,
    other: isMine ? msg.toUser : msg.fromUser,
  }
}

/**
 * cross-account history view の entry 構築 (#460)。
 * 全アカウントから集めた message を thread (room/DM) 単位の最新 1 件に dedup する。
 * cache hydrate phase / API reconcile phase の両方から呼ぶ。
 */
export function buildCrossAccountHistoryEntries(
  allMessages: { msg: ChatMessage; accountId: string; host: string }[],
  getUserId: (accountId: string) => string | undefined,
): CrossAccountChatHistoryEntry[] {
  const entries: CrossAccountChatHistoryEntry[] = []
  const seen = new Set<string>()
  const sorted = [...allMessages].sort(
    (a, b) =>
      new Date(b.msg.createdAt).getTime() - new Date(a.msg.createdAt).getTime(),
  )

  for (const { msg, accountId, host } of sorted) {
    const uid = getUserId(accountId)
    if (msg.toRoomId) {
      const key = `${accountId}:room:${msg.toRoomId}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        key,
        accountId,
        serverHost: host,
        message: msg,
        isRoom: true,
        name: msg.toRoom?.name || 'Room',
        hasName: !!msg.toRoom?.name,
        // ChatRoom には emojis 辞書が無いので、最新メッセージ送信者の辞書で代替する
        // (同一サーバー上の shortcode は同じ辞書で解決できる)
        emojis: msg.fromUser?.emojis ?? undefined,
        avatarUrl: msg.fromUser?.avatarUrl ?? undefined,
        avatarDecorations: msg.fromUser?.avatarDecorations,
        roomId: msg.toRoomId,
      })
    } else {
      const { otherId, other } = resolveOther(msg, uid)
      if (!otherId) continue
      const key = `${accountId}:user:${otherId}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        key,
        accountId,
        serverHost: host,
        message: msg,
        isRoom: false,
        name: other?.name || other?.username || otherId,
        hasName: !!other?.name,
        emojis: other?.emojis ?? undefined,
        avatarUrl: other?.avatarUrl ?? undefined,
        avatarDecorations: other?.avatarDecorations,
        otherId,
      })
    }
  }

  return entries
}

/**
 * per-account history view の entry 構築。入力 (chat/history 由来) は
 * 新しい順で来る前提で、thread 単位の最初の 1 件を採る。
 */
export function buildPerAccountHistoryEntries(
  msgs: ChatMessage[],
  myUserId: string | undefined,
): PerAccountChatHistoryEntry[] {
  const seen = new Set<string>()
  const entries: PerAccountChatHistoryEntry[] = []

  for (const msg of msgs) {
    if (msg.toRoomId) {
      if (seen.has(`room:${msg.toRoomId}`)) continue
      seen.add(`room:${msg.toRoomId}`)
      entries.push({
        key: `room:${msg.toRoomId}`,
        message: msg,
        isRoom: true,
        name: msg.toRoom?.name || 'Room',
        hasName: !!msg.toRoom?.name,
        emojis: msg.fromUser?.emojis ?? undefined,
        avatarUrl: msg.fromUser?.avatarUrl ?? undefined,
        avatarDecorations: msg.fromUser?.avatarDecorations,
      })
    } else {
      const { otherId, other } = resolveOther(msg, myUserId)
      if (!otherId || seen.has(`user:${otherId}`)) continue
      seen.add(`user:${otherId}`)
      entries.push({
        key: `user:${otherId}`,
        message: msg,
        isRoom: false,
        name: other?.name || other?.username || otherId,
        hasName: !!other?.name,
        emojis: other?.emojis ?? undefined,
        avatarUrl: other?.avatarUrl ?? undefined,
        avatarDecorations: other?.avatarDecorations,
        otherId,
      })
    }
  }

  return entries
}

/**
 * Per-account history から prefetch 対象 thread を抽出する (#460 B-6)。
 * `fromUserId === uid` で送信側 / 受信側を判定して thread の相手
 * (otherId or roomId) を導出する。
 */
export function buildPerAccountPrefetchTargets(
  accountId: string,
  uid: string | undefined,
  msgs: ChatMessage[],
): PrefetchTarget[] {
  const seen = new Set<string>()
  const targets: PrefetchTarget[] = []
  for (const msg of msgs) {
    if (msg.toRoomId) {
      const key = `room:${msg.toRoomId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({ accountId, isRoom: true, targetId: msg.toRoomId })
    } else {
      const { otherId } = resolveOther(msg, uid)
      if (!otherId) continue
      const key = `user:${otherId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({ accountId, isRoom: false, targetId: otherId })
    }
  }
  return targets
}

/**
 * 履歴 view (#483) の絞り込み。thread 名 + 直近メッセージのプレビュー本文を
 * 大文字小文字無視の substring match で判定する。空クエリは常に match。
 */
export function matchesChatSearch(
  query: string,
  name: string,
  preview: string | null | undefined,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (name.toLowerCase().includes(q)) return true
  if (preview?.toLowerCase().includes(q)) return true
  return false
}

/**
 * 会話 view 内検索 (#483 v1) の message 単位 match。
 * 本文 / 送信者名 / username / 添付ファイル名を対象にする。
 */
export function chatMessageMatchesSearch(
  query: string,
  m: ChatMessage,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (m.text?.toLowerCase().includes(q)) return true
  const u = m.fromUser
  if (u?.name?.toLowerCase().includes(q)) return true
  if (u?.username?.toLowerCase().includes(q)) return true
  if (m.file?.name.toLowerCase().includes(q)) return true
  return false
}

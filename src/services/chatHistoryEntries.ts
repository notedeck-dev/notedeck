import type { AvatarDecoration, ChatMessage, ChatUser } from '@/adapters/types'
import type { ChatThreadTarget } from '@/composables/useChatThread'
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

/**
 * 履歴の未読の点 (#1207)。本家 MkChatHistories と同じく、相手からの未読の
 * 最新メッセージに出す。開いた会話 (`openedIds`) は履歴を取り直すまで消しておく。
 * ログアウト中の履歴は手元のキャッシュで、既読状態は保存した時点のまま
 * 更新されないため、読み終えた会話にも点が残る。分からないときは出さない (#1216)
 */
export function isChatHistoryUnread(
  message: ChatMessage,
  myUserId: string | undefined,
  opts: { loggedOut: boolean; openedIds: ReadonlySet<string> },
): boolean {
  return (
    !opts.loggedOut &&
    message.isRead === false &&
    message.fromUserId !== myUserId &&
    !opts.openedIds.has(message.id)
  )
}

/**
 * 会話から履歴に戻るとき、会話で見た最新メッセージを履歴へ反映する (#1216)。
 * 履歴は購読していないので、会話中の新着や送信は取り直すまで並びにも
 * プレビューにも出ない。新しい順に並べ直し、同じ id は差し替える
 */
export function withLatestChatMessage(
  history: ChatMessage[],
  latest: ChatMessage,
): ChatMessage[] {
  return [latest, ...history.filter((m) => m.id !== latest.id)].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/** {@link withLatestChatMessage} の全アカウント版。entry を組み直す */
export function withLatestCrossAccountMessage(
  entries: CrossAccountChatHistoryEntry[],
  latest: { msg: ChatMessage; accountId: string; host: string },
  getUserId: (accountId: string) => string | undefined,
): CrossAccountChatHistoryEntry[] {
  return buildCrossAccountHistoryEntries(
    [
      latest,
      ...entries
        .filter((e) => e.message.id !== latest.msg.id)
        .map((e) => ({
          msg: e.message,
          accountId: e.accountId,
          host: e.serverHost,
        })),
    ],
    getUserId,
  )
}

/**
 * 別の会話に来た新着 (main ストリームの newChatMessage) を履歴に足す形にする。
 * 本家は受信から 3 秒たっても既読にならなかったメッセージだけを流し
 * (ChatService)、本文に isRead を載せない (載せるのは chat/history だけ) ので、
 * 未読として足す
 */
export function newChatMessageForHistory(msg: ChatMessage): ChatMessage {
  return { ...msg, isRead: false }
}

/** メッセージが開いている会話のものか。新着を履歴に足すとき、見ている会話は未読にしない */
export function isChatMessageInThread(
  msg: ChatMessage,
  target: ChatThreadTarget | null,
  myUserId: string | undefined,
): boolean {
  if (!target) return false
  if (target.kind === 'room') return msg.toRoomId === target.roomId
  if (msg.toRoomId) return false
  return resolveOther(msg, myUserId).otherId === target.otherId
}

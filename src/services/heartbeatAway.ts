import type { ChatMessage } from '@/composables/useAiChat'

/** アプリを閉じている間に HEARTBEAT が書いたもの (#1165) */
export interface HeartbeatAwaySummary {
  /** AI が「通知して」とした報告の数 */
  reports: number
  /** 確認待ちの操作の数 */
  pending: number
  /** 最後に知らせたものの報告先 (押したら開く先)。報告先が「なし」なら null */
  sessionId: string | null
}

/** notemaid が記録した「通知して」の報告 (報告先が「なし」なら sessionId は null, #1227) */
export interface HeartbeatNoticeRecord {
  at: number
  sessionId: string | null
}

/**
 * 最後にアプリで見た時刻 (`since`, ms) より後に HEARTBEAT が知らせたものを数える。
 * 報告は notemaid の記録 (開いている間に `notify` を流したものと同じ基準) から、
 * 確認待ちは全セッションの受信箱カードから数える。何も無ければ null
 */
export function summarizeHeartbeatAway(
  sessions: readonly { id: string; messages: readonly ChatMessage[] }[],
  notices: readonly HeartbeatNoticeRecord[],
  since: number,
): HeartbeatAwaySummary | null {
  let reports = 0
  let pending = 0
  let latest: { sessionId: string | null; at: number } | null = null
  for (const n of notices) {
    if (n.at <= since) continue
    reports++
    if (!latest || n.at > latest.at) {
      latest = { sessionId: n.sessionId, at: n.at }
    }
  }
  for (const s of sessions) {
    for (const m of s.messages) {
      if (!m.heartbeat || !m.intent || m.timestamp <= since) continue
      if (m.intent.status !== 'pending' && m.intent.status !== 'drafted') {
        continue
      }
      pending++
      if (!latest || m.timestamp > latest.at) {
        latest = { sessionId: s.id, at: m.timestamp }
      }
    }
  }
  if (!latest) return null
  return { reports, pending, sessionId: latest.sessionId }
}

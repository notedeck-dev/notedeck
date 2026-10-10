import type { ChatMessage } from '@/composables/useAiChat'

/** アプリを閉じている間に HEARTBEAT が書いたもの (#1165) */
export interface HeartbeatAwaySummary {
  /** 報告の数 (確認待ちのカードと失敗の記録は含めない) */
  reports: number
  /** 確認待ちの操作の数 */
  pending: number
  /** 最後に書かれたセッション (押したら開く先) */
  sessionId: string
}

const FAILED_MESSAGE_KEY = '_native.heartbeat.failedMessage'

function isFailure(m: ChatMessage): boolean {
  const content = m.i18n?.content as { key?: unknown } | undefined
  return content?.key === FAILED_MESSAGE_KEY
}

/**
 * 最後にアプリで見た時刻 (`since`, ms) より後に HEARTBEAT が書いた報告と確認待ちを
 * 数える。正本はセッションなので、報告先の設定 (専用セッション / 任意のセッション)
 * に関わらず全セッションの HEARTBEAT メッセージを見る。何も無ければ null
 */
export function summarizeHeartbeatAway(
  sessions: readonly { id: string; messages: readonly ChatMessage[] }[],
  since: number,
): HeartbeatAwaySummary | null {
  let reports = 0
  let pending = 0
  let latest: { sessionId: string; at: number } | null = null
  for (const s of sessions) {
    for (const m of s.messages) {
      if (!m.heartbeat || m.timestamp <= since) continue
      if (m.intent) {
        if (m.intent.status !== 'pending' && m.intent.status !== 'drafted') {
          continue
        }
        pending++
      } else if (isFailure(m)) {
        continue
      } else {
        reports++
      }
      if (!latest || m.timestamp > latest.at) {
        latest = { sessionId: s.id, at: m.timestamp }
      }
    }
  }
  if (!latest) return null
  return { reports, pending, sessionId: latest.sessionId }
}

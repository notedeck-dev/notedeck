import { reactive } from 'vue'
import type { StreamConnectionState } from '@/adapters/types'

/**
 * アカウント別のストリーム接続状態 (#698)。
 *
 * MisskeyStream.setStatus (単一ファネル) が唯一の書き込み元で、grace で
 * デバウンスされる表示用 state と違い、ここには生の遷移をそのまま記録する。
 * healthcheck の診断行とオフラインバッジの tooltip が「いつからこの状態か」
 * を表示するために読む。
 */
export interface StreamHealth {
  state: StreamConnectionState
  /** この state に遷移した時刻 (epoch ms) */
  since: number
}

const healthByAccount = reactive(new Map<string, StreamHealth>())

export function recordStreamHealth(
  accountId: string,
  state: StreamConnectionState,
): void {
  const prev = healthByAccount.get(accountId)
  if (prev?.state === state) return
  healthByAccount.set(accountId, { state, since: Date.now() })
}

export function getStreamHealth(accountId: string): StreamHealth | undefined {
  return healthByAccount.get(accountId)
}

/** アカウントのライフサイクル終端 (削除/ログアウト) で呼ぶ。 */
export function removeStreamHealth(accountId: string): void {
  healthByAccount.delete(accountId)
}

/** 全アカウントの接続状態スナップショット。/api/health が読む (#709)。 */
export function listStreamHealth(): Array<
  { accountId: string } & StreamHealth
> {
  return [...healthByAccount.entries()].map(([accountId, h]) => ({
    accountId,
    ...h,
  }))
}

/**
 * 全接続の匿名集約 (metrics.read が返す streaming セクション)。
 * accountId は含めない。
 */
export type OverallStreamHealth =
  | 'unknown'
  | 'initializing'
  | 'healthy'
  | 'degraded'
  | 'offline'
  | 'manual-offline'

export interface StreamHealthSummary {
  observedConnectionCount: number
  byState: Record<StreamConnectionState, number>
  overallHealth: OverallStreamHealth
  lastTransitionAt: number | null
}

/**
 * 接続状態の集約分類。AboutContent の診断行 / DeckNoteColumn のバッジ詳細
 * (どちらも per-account 判定) と semantics を揃える場所としてここに置く。
 */
export function summarizeStreamHealth(
  streams: readonly StreamHealth[],
  manualOffline: boolean,
): StreamHealthSummary {
  // 'initializing' は現状 health map に届かない: 書き込み元の backend enum
  // (bindings.ts の StreamConnectionState) は connected / reconnecting /
  // disconnected の 3 値で、initializing はフロント union の seed 状態。
  // 型網羅と将来の遷移記録に備えて分岐は残す
  const byState: Record<StreamConnectionState, number> = {
    initializing: 0,
    connected: 0,
    reconnecting: 0,
    disconnected: 0,
  }
  let lastTransitionAt: number | null = null

  for (const stream of streams) {
    byState[stream.state]++
    lastTransitionAt = Math.max(lastTransitionAt ?? stream.since, stream.since)
  }

  const observedConnectionCount = streams.length
  let overallHealth: OverallStreamHealth
  if (manualOffline) {
    overallHealth = 'manual-offline'
  } else if (observedConnectionCount === 0) {
    overallHealth = 'unknown'
  } else if (byState.connected === observedConnectionCount) {
    overallHealth = 'healthy'
  } else if (byState.disconnected === observedConnectionCount) {
    overallHealth = 'offline'
  } else if (byState.reconnecting > 0 || byState.disconnected > 0) {
    overallHealth = 'degraded'
  } else {
    overallHealth = 'initializing'
  }

  return {
    observedConnectionCount,
    byState,
    overallHealth,
    lastTransitionAt,
  }
}

/** 「N分前から」「N秒前から」の短い表示。 */
export function formatHealthDuration(since: number): string {
  const elapsedMs = Date.now() - since
  const mins = Math.floor(elapsedMs / 60_000)
  if (mins >= 60) return `${Math.floor(mins / 60)}時間前から`
  if (mins >= 1) return `${mins}分前から`
  return `${Math.max(1, Math.floor(elapsedMs / 1000))}秒前から`
}

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

/** 「N分前から」「N秒前から」の短い表示。 */
export function formatHealthDuration(since: number): string {
  const elapsedMs = Date.now() - since
  const mins = Math.floor(elapsedMs / 60_000)
  if (mins >= 60) return `${Math.floor(mins / 60)}時間前から`
  if (mins >= 1) return `${mins}分前から`
  return `${Math.max(1, Math.floor(elapsedMs / 1000))}秒前から`
}

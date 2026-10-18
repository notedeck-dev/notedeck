/**
 * 期限つきユーザーミュートの純ロジック (#1260)。
 *
 * mute store は「集合 + 予約」の配線だけを持ち、期限の判定 (期限切れの除外、
 * setTimeout の上限での分割、復帰時の掃除、失敗した同期の再試行の可否) は
 * ここで `now` を引数に取る純関数として持つ (#782)。
 */

/** setTimeout が扱える最大の遅延 (2^31 - 1 ms ≒ 24.8 日) */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1

/** 失敗した同期を復帰信号で打ち直すまでの最短間隔 (アカウント単位) */
export const SYNC_RETRY_MIN_INTERVAL_MS = 60_000

/** 同期 (mute/list) で取り込む 1 件。期限は UNIX ms、無期限は null */
export interface MutedUser {
  userId: string
  expiresAt: number | null
}

/**
 * mute/list の `expiresAt` (ISO 8601 or null) を UNIX ms にする。
 * 読めない値は無期限扱い (隠したまま) にする — 安全側。
 */
export function parseMutingExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  const ms = Date.parse(expiresAt)
  if (!Number.isFinite(ms)) {
    console.warn('[mute-sync] unreadable expiresAt, treating as indefinite', {
      expiresAt,
    })
    return null
  }
  return ms
}

/**
 * 同期結果を「手元の集合に入れる ID」と「期限の予約が要る要素」に分ける。
 * 期限が過ぎているものは入れない (サーバーの整理が遅れていて mute/list に残る)。
 */
export function partitionMutings(
  entries: readonly MutedUser[],
  now: number,
): { active: string[]; expiring: { userId: string; expiresAt: number }[] } {
  const active: string[] = []
  const expiring: { userId: string; expiresAt: number }[] = []
  for (const e of entries) {
    if (e.expiresAt === null) {
      active.push(e.userId)
      continue
    }
    if (e.expiresAt <= now) continue
    active.push(e.userId)
    expiring.push({ userId: e.userId, expiresAt: e.expiresAt })
  }
  return { active, expiring }
}

/**
 * 次に待つ遅延。setTimeout は約 24.8 日までしか待てないので上限で切り、
 * 発火側が残りを予約し直す。期限が過ぎていれば null (= 今すぐ外す)。
 */
export function nextExpiryDelay(expiresAt: number, now: number): number | null {
  const delay = expiresAt - now
  if (delay <= 0) return null
  return Math.min(delay, MAX_TIMEOUT_MS)
}

/** 復帰時の掃除: 期限が過ぎた key を返す (スリープ中は timer が進まない) */
export function expiredKeys(
  entries: Iterable<[string, number]>,
  now: number,
): string[] {
  const out: string[] = []
  for (const [key, expiresAt] of entries) {
    if (expiresAt <= now) out.push(key)
  }
  return out
}

/** 直前の同期失敗の記録 */
export interface SyncFailure {
  at: number
  /** 認証エラー (トークン失効など)。再ログインしない限り直らないので再試行しない */
  auth: boolean
}

export function shouldRetrySync(
  failure: SyncFailure | undefined,
  now: number,
): boolean {
  if (!failure) return true
  if (failure.auth) return false
  return now - failure.at >= SYNC_RETRY_MIN_INTERVAL_MS
}

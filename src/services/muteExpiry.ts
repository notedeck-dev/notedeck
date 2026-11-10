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

/**
 * 同期済みのアカウントを復帰信号で取り込み直すまでの最短間隔 (#1268)。
 * 復帰のたび (alt-tab のたび) に全ページ取得にならないよう間を空ける
 */
export const RESYNC_MIN_INTERVAL_MS = 5 * 60_000

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
  /** 認証エラー (トークン失効、権限不足など)。再ログインしない限り直らないので再試行しない */
  auth: boolean
}

export function shouldRetrySync(
  failure: SyncFailure | undefined,
  now: number,
): boolean {
  if (!failure) return true
  if (failure.auth) return false
  // 時計が戻って記録が未来になっていたら、追いつくのを待たずに打つ
  if (now < failure.at) return true
  return now - failure.at >= SYNC_RETRY_MIN_INTERVAL_MS
}

/** 同期済みのアカウントを取り込み直してよいか (最後の取り込みから間隔が空いたか) */
export function shouldResync(
  lastSyncedAt: number | undefined,
  now: number,
): boolean {
  if (lastSyncedAt === undefined) return true
  if (now < lastSyncedAt) return true
  return now - lastSyncedAt >= RESYNC_MIN_INTERVAL_MS
}

let opSeq = 0

/**
 * 手元の操作と取り込みの開始に振る、プロセス内で単調に増える採番 (#1268)。
 * 前後関係だけが要るので壁時計は使わない (NTP 補正などで時計が戻っても
 * 「取り込み後の操作」が「取り込み前」に化けない)
 */
export function nextOpSeq(): number {
  opSeq += 1
  return opSeq
}

/**
 * 手元で行ったミュート操作の記録 (取り込みとの競合判定用、#1268)。
 * `seq` は `nextOpSeq()` の採番。`mute` の `expiresAt` は数値が期限、null が無期限、
 * undefined が「期限が分からない」(ALREADY_MUTING で手元だけ合わせたとき)
 */
export interface LocalMuteOp {
  kind: 'mute' | 'unmute'
  seq: number
  expiresAt?: number | null
}

/**
 * 取り込み結果に手元の操作を重ねる (#1268)。規則は「手で押した方が勝つ」:
 * 取り込みを始めた採番 (`startSeq`) より後の操作は取り込み結果で上書きしない
 * (解除した相手は結果に居ても戻さず、付けた相手は結果に無くても期限ごと残す)。
 * 始める前の操作はサーバーに反映済みなので捨てる (`staleOps`)。手元の操作は
 * API が成功した後に記録される。
 *
 * 期限が分からない手元のミュートは、サーバーが知っていればその期限、知らなければ
 * 無期限として入れて `unknownExpiry` に印を付ける
 */
export function reconcileMutedUsers(
  server: readonly MutedUser[],
  localOps: ReadonlyMap<string, LocalMuteOp>,
  startSeq: number,
): { entries: MutedUser[]; unknownExpiry: string[]; staleOps: string[] } {
  const staleOps: string[] = []
  const recent = new Map<string, LocalMuteOp>()
  for (const [userId, op] of localOps) {
    if (op.seq < startSeq) staleOps.push(userId)
    else recent.set(userId, op)
  }
  const entries: MutedUser[] = []
  const unknownExpiry: string[] = []
  for (const e of server) {
    const op = recent.get(e.userId)
    if (op?.kind === 'unmute') continue
    if (op?.kind === 'mute') {
      recent.delete(e.userId)
      entries.push(
        op.expiresAt === undefined
          ? e
          : { userId: e.userId, expiresAt: op.expiresAt },
      )
      continue
    }
    entries.push(e)
  }
  for (const [userId, op] of recent) {
    if (op.kind !== 'mute') continue
    if (op.expiresAt === undefined) {
      entries.push({ userId, expiresAt: null })
      unknownExpiry.push(userId)
    } else {
      entries.push({ userId, expiresAt: op.expiresAt })
    }
  }
  return { entries, unknownExpiry, staleOps }
}

/** 期限の無い集合 (リノートミュート) への同じ規則 */
export function reconcileIds(
  server: readonly string[],
  localOps: ReadonlyMap<string, LocalMuteOp>,
  startSeq: number,
): { ids: string[]; staleOps: string[] } {
  const staleOps: string[] = []
  const recent = new Map<string, LocalMuteOp>()
  for (const [id, op] of localOps) {
    if (op.seq < startSeq) staleOps.push(id)
    else recent.set(id, op)
  }
  const ids: string[] = []
  for (const id of server) {
    const op = recent.get(id)
    if (op?.kind === 'unmute') continue
    recent.delete(id)
    ids.push(id)
  }
  for (const [id, op] of recent) {
    if (op.kind === 'mute') ids.push(id)
  }
  return { ids, staleOps }
}

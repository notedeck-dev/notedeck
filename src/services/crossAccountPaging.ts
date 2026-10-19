/**
 * 全アカウント面の下方向ページング (#1184)。
 *
 * 複数アカウントの TL を 1 列に混ぜるとき、列の底は「まだ遡れるアカウントのうち
 * 到達点がいちばん浅いもの」で揃える (k-way merge の水平線)。それより古い行は
 * 他のアカウントがまだ取っていない時間帯なので、表示に出すと塊になって挟まる。
 *
 * - カーソルは列の行ではなく「取得した生ページの最古」で単調に進む (per-account の
 *   fetchCursor と同じ規則、#831 §1.4)。列の切り詰めで行が消えても位置を失わない
 * - 失敗は「尽きた」と区別し、指数バックオフの間は取らない。失敗中も水平線には残す
 *   (外すと復帰後のページが既表示行の間に差し込まれ、症状の縮小版が再発する)
 * - 水平線は接続中は単調に下がるだけ。全アカウントが尽きたら制限なし (null)
 */

import type { NormalizedNote } from '@/adapters/types'

export interface PageCursor {
  id: string
  createdAt: string
}

export interface AccountCursor {
  accountId: string
  /** 取得済みの生ページ (フィルタ前) の最古。null はまだ 1 ページも取っていない */
  oldest: PageCursor | null
  /** 空ページが返り、これ以上遡れない */
  exhausted: boolean
  /** 連続失敗回数 */
  failures: number
  /** この時刻 (epoch ms) までは取らない。0 は制限なし */
  nextRetryAt: number
}

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 60_000

export function initialCursor(
  accountId: string,
  opts: { exhausted?: boolean } = {},
): AccountCursor {
  return {
    accountId,
    oldest: null,
    exhausted: opts.exhausted === true,
    failures: 0,
    nextRetryAt: 0,
  }
}

function oldestOf(notes: readonly NormalizedNote[]): PageCursor | null {
  let oldest: NormalizedNote | null = null
  for (const n of notes) {
    if (!oldest || n.createdAt < oldest.createdAt) oldest = n
  }
  return oldest ? { id: oldest.id, createdAt: oldest.createdAt } : null
}

/** 生ページを取り込んだ。空なら尽きた。最古が現在より古いときだけ前進する */
export function advanceCursor(
  cursor: AccountCursor,
  rawPage: readonly NormalizedNote[],
): AccountCursor {
  const oldest = oldestOf(rawPage)
  if (!oldest) {
    return { ...cursor, exhausted: true, failures: 0, nextRetryAt: 0 }
  }
  const next =
    cursor.oldest && oldest.createdAt >= cursor.oldest.createdAt
      ? cursor.oldest
      : oldest
  return { ...cursor, oldest: next, failures: 0, nextRetryAt: 0 }
}

/** 全置換 (起動 / gap の取り直し)。旧カーソルが残ると間の時間帯を黙って飛ばす */
export function resetCursor(
  cursor: AccountCursor,
  rawPage: readonly NormalizedNote[],
): AccountCursor {
  const oldest = oldestOf(rawPage)
  return {
    ...cursor,
    oldest,
    exhausted: oldest === null,
    failures: 0,
    nextRetryAt: 0,
  }
}

export function markFailed(cursor: AccountCursor, now: number): AccountCursor {
  const failures = cursor.failures + 1
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1))
  return { ...cursor, failures, nextRetryAt: now + delay }
}

/**
 * 列の切り詰めで行が落ちた後の再設定。そのアカウントの行が列に残っていれば
 * その最古に戻す (落ちた行を飛ばさない)。1 行も残っていなければ生ページ基準のまま
 * (ページ全件がフィルタで落ちても前進する)
 */
export function reseedFromRows(
  cursor: AccountCursor,
  rows: readonly NormalizedNote[],
): AccountCursor {
  const oldest = oldestOf(rows)
  return oldest ? { ...cursor, oldest } : cursor
}

/** まだ遡れるアカウントのうち、最古行がいちばん新しいもの。無ければ制限なし */
export function horizonOf(cursors: readonly AccountCursor[]): string | null {
  let horizon: string | null = null
  for (const c of cursors) {
    if (c.exhausted || !c.oldest) continue
    if (horizon === null || c.oldest.createdAt > horizon) {
      horizon = c.oldest.createdAt
    }
  }
  return horizon
}

/** 単調非増加の水平線。全員尽きたら制限なしに開く */
export function nextHorizon(
  prev: string | null,
  cursors: readonly AccountCursor[],
): string | null {
  const h = horizonOf(cursors)
  if (h === null) return null
  if (prev !== null && h > prev) return prev
  return h
}

/**
 * 次に 1 ページ取るアカウント。まだ 1 ページも無いアカウントを先に、無ければ
 * 水平線を決めているアカウント。それがバックオフ中なら null (他のアカウントで
 * 底を掘り進めると、隠れる尾が有界でなくなる)
 */
export function pickNextAccount(
  cursors: readonly AccountCursor[],
  now: number,
): string | null {
  const live = cursors.filter((c) => !c.exhausted)
  const missing = live.find((c) => !c.oldest && c.nextRetryAt <= now)
  if (missing) return missing.accountId
  let top: AccountCursor | null = null
  let topCreatedAt = ''
  for (const c of live) {
    if (!c.oldest) continue
    if (!top || c.oldest.createdAt > topCreatedAt) {
      top = c
      topCreatedAt = c.oldest.createdAt
    }
  }
  if (!top) return null
  return top.nextRetryAt <= now ? top.accountId : null
}

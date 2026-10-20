/**
 * レート制限 (HTTP 429 / RATE_LIMIT_EXCEEDED、#1271) で次に叩くまでの待ち時間。
 * サーバーが示した時間 (`Retry-After` / `error.info.resetMs`、Rust 側で ms に揃う)
 * を優先し、無ければ既定で待つ。一般の失敗の指数バックオフとは別の勘定。
 */

import { AppError } from '@/utils/errors'

/** 待ち時間が分からないときの既定。短すぎると叩き直して制限を延ばす */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 30_000
/** 壊れたヘッダーや時計ずれで列が止まったままにならないための上限 */
export const RATE_LIMIT_MAX_WAIT_MS = 10 * 60_000

export function rateLimitWaitMs(retryAfterMs: number | null): number {
  if (retryAfterMs === null || retryAfterMs <= 0)
    return RATE_LIMIT_DEFAULT_WAIT_MS
  return Math.min(RATE_LIMIT_MAX_WAIT_MS, retryAfterMs)
}

/**
 * 失敗がレート制限なら待ち時間 (分からなければ null)、それ以外は undefined。
 * `markFailed(cursor, now, rateLimitRetryAfter(e))` の形で、一般の失敗は指数
 * バックオフのまま、レート制限だけサーバーの時間に従わせる
 */
export function rateLimitRetryAfter(e: unknown): number | null | undefined {
  const err = AppError.from(e)
  return err.isRateLimited ? err.retryAfterMs : undefined
}

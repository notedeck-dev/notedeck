import { describe, expect, it } from 'vitest'
import {
  RATE_LIMIT_DEFAULT_WAIT_MS,
  RATE_LIMIT_MAX_WAIT_MS,
  rateLimitWaitMs,
} from './rateLimit'

describe('rateLimitWaitMs (#1271)', () => {
  it('サーバーが示した待ち時間をそのまま使う', () => {
    expect(rateLimitWaitMs(7000)).toBe(7000)
  })

  it('示されていなければ既定の待ち時間', () => {
    expect(rateLimitWaitMs(null)).toBe(RATE_LIMIT_DEFAULT_WAIT_MS)
  })

  it('0 や負の値は既定に戻す (ヘッダーの丸めで 0 になることがある)', () => {
    expect(rateLimitWaitMs(0)).toBe(RATE_LIMIT_DEFAULT_WAIT_MS)
    expect(rateLimitWaitMs(-5)).toBe(RATE_LIMIT_DEFAULT_WAIT_MS)
  })

  it('異常に長い値は上限で切る (壊れたヘッダーで列が止まったままにならない)', () => {
    expect(rateLimitWaitMs(RATE_LIMIT_MAX_WAIT_MS * 10)).toBe(
      RATE_LIMIT_MAX_WAIT_MS,
    )
  })
})

describe('rateLimitRetryAfter (#1271)', () => {
  it('レート制限なら待ち時間 (無ければ null)、それ以外は undefined', async () => {
    const { rateLimitRetryAfter } = await import('./rateLimit')
    expect(
      rateLimitRetryAfter({
        code: 'RATE_LIMITED',
        message: 'x',
        retryAfterMs: 7000,
      }),
    ).toBe(7000)
    expect(
      rateLimitRetryAfter({
        code: 'RATE_LIMITED',
        message: 'x',
        retryAfterMs: null,
      }),
    ).toBeNull()
    expect(rateLimitRetryAfter(new Error('offline'))).toBeUndefined()
  })
})

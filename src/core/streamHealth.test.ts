import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatHealthDuration,
  getStreamHealth,
  recordStreamHealth,
  removeStreamHealth,
  type StreamHealth,
  summarizeStreamHealth,
} from './streamHealth'

describe('streamHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    removeStreamHealth('acc-1')
    vi.useRealTimers()
  })

  it('遷移を記録し、同じ state の再記録では since を動かさない', () => {
    recordStreamHealth('acc-1', 'reconnecting')
    vi.setSystemTime(1_060_000)
    recordStreamHealth('acc-1', 'reconnecting')
    expect(getStreamHealth('acc-1')).toEqual({
      state: 'reconnecting',
      since: 1_000_000,
    })

    // 別 state への遷移で since が更新される
    recordStreamHealth('acc-1', 'connected')
    expect(getStreamHealth('acc-1')).toEqual({
      state: 'connected',
      since: 1_060_000,
    })
  })

  it('removeStreamHealth で消える', () => {
    recordStreamHealth('acc-1', 'connected')
    removeStreamHealth('acc-1')
    expect(getStreamHealth('acc-1')).toBeUndefined()
  })

  it('継続時間を秒/分/時間で表示する', () => {
    const now = Date.now()
    expect(formatHealthDuration(now - 5_000)).toBe('5秒前から')
    expect(formatHealthDuration(now - 3 * 60_000)).toBe('3分前から')
    expect(formatHealthDuration(now - 2 * 3_600_000)).toBe('2時間前から')
  })
})

describe('summarizeStreamHealth', () => {
  const stream = (
    state: StreamHealth['state'],
    since: number,
  ): StreamHealth => ({ state, since })

  it('接続なしは unknown、全接続 connected は healthy', () => {
    expect(summarizeStreamHealth([], false).overallHealth).toBe('unknown')
    const all = summarizeStreamHealth(
      [stream('connected', 100), stream('connected', 200)],
      false,
    )
    expect(all.overallHealth).toBe('healthy')
    expect(all.observedConnectionCount).toBe(2)
    expect(all.byState.connected).toBe(2)
    expect(all.lastTransitionAt).toBe(200)
  })

  it('全断は offline、一部断/再接続は degraded', () => {
    expect(
      summarizeStreamHealth([stream('disconnected', 100)], false).overallHealth,
    ).toBe('offline')
    expect(
      summarizeStreamHealth(
        [stream('connected', 100), stream('reconnecting', 200)],
        false,
      ).overallHealth,
    ).toBe('degraded')
  })

  it('手動オフラインは接続状態によらず manual-offline', () => {
    expect(
      summarizeStreamHealth([stream('disconnected', 100)], true).overallHealth,
    ).toBe('manual-offline')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatHealthDuration,
  getStreamHealth,
  recordStreamHealth,
  removeStreamHealth,
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

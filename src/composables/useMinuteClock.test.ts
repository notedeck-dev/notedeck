import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type EffectScope, effectScope } from 'vue'
import { useMinuteClock } from './useMinuteClock'

function subscribe(scope: EffectScope) {
  const clock = scope.run(() => useMinuteClock())
  if (!clock) throw new Error('scope is inactive')
  return clock
}

describe('useMinuteClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T12:00:30Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('分の境目で now を進め、購読が無くなればタイマーを止める', () => {
    const a = effectScope()
    const b = effectScope()
    const clockA = subscribe(a)
    const clockB = subscribe(b)
    // 何人購読してもタイマーは 1 本
    expect(vi.getTimerCount()).toBe(1)
    expect(clockA).toBe(clockB)

    const before = clockA.value
    vi.advanceTimersByTime(29_000)
    expect(clockA.value).toBe(before)
    vi.advanceTimersByTime(2_000)
    expect(clockA.value).toBeGreaterThanOrEqual(
      new Date('2026-10-09T12:01:00Z').getTime(),
    )

    a.stop()
    expect(vi.getTimerCount()).toBe(1)
    b.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('購読し直すと現在時刻から始める', () => {
    const s = effectScope()
    s.run(() => useMinuteClock())
    s.stop()
    vi.setSystemTime(new Date('2026-10-09T13:00:00Z'))
    const s2 = effectScope()
    const clock = subscribe(s2)
    expect(clock.value).toBe(new Date('2026-10-09T13:00:00Z').getTime())
    s2.stop()
  })
})

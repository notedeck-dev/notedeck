import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SLEEP_JUMP_THRESHOLD_MS,
  SLEEP_TICK_INTERVAL_MS,
  startSleepDetector,
} from './sleepDetector'

describe('sleepDetector (#791)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('通常の tick では発火しない', () => {
    const onWake = vi.fn()
    const stop = startSleepDetector(onWake)
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS * 5)
    expect(onWake).not.toHaveBeenCalled()
    stop()
  })

  it('スリープ相当の時刻ジャンプ後の tick で発火する', () => {
    const onWake = vi.fn()
    const stop = startSleepDetector(onWake)
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS)
    // スリープ中はタイマーが止まったまま壁時計だけ進む
    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000)
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS)
    expect(onWake).toHaveBeenCalledTimes(1)
    // 復帰後の通常 tick では再発火しない
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS * 2)
    expect(onWake).toHaveBeenCalledTimes(1)
    stop()
  })

  it('閾値以下のジャンプでは発火しない', () => {
    const onWake = vi.fn()
    const stop = startSleepDetector(onWake)
    vi.setSystemTime(
      Date.now() + SLEEP_JUMP_THRESHOLD_MS - SLEEP_TICK_INTERVAL_MS - 1000,
    )
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS)
    expect(onWake).not.toHaveBeenCalled()
    stop()
  })

  it('stop 後は発火しない', () => {
    const onWake = vi.fn()
    const stop = startSleepDetector(onWake)
    stop()
    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000)
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS * 2)
    expect(onWake).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { animateScrollLeft } from './motion'

describe('animateScrollLeft', () => {
  let now = 0
  beforeEach(() => {
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => {
        now += 16
        cb(now)
      }, 0),
    )
    vi.useFakeTimers({ toFake: ['setTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('指定した時間で目標まで動き、途中は吸着を外して着いたら戻す', async () => {
    const el = document.createElement('div')
    el.style.scrollSnapType = 'x mandatory'
    let left = 0
    Object.defineProperty(el, 'scrollLeft', {
      get: () => left,
      set: (v: number) => {
        left = v
      },
    })
    const done = animateScrollLeft(el, 400, 160)
    await vi.advanceTimersByTimeAsync(0)
    expect(el.style.scrollSnapType).toBe('none')
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThan(400)
    await vi.advanceTimersByTimeAsync(200)
    await done
    expect(left).toBe(400)
    expect(el.style.scrollSnapType).toBe('x mandatory')
  })
})

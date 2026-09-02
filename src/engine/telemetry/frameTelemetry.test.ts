import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TestFrameStats = {
  fps: number
  frameTimeEma: number
  jankCount: number
  lastFrameTime: number
}

const frameEngineMock = vi.hoisted(() => ({
  listener: null as ((stats: TestFrameStats) => void) | null,
  unsubscribe: vi.fn(),
  onFrame: vi.fn((listener: (stats: TestFrameStats) => void) => {
    frameEngineMock.listener = listener
    return frameEngineMock.unsubscribe
  }),
}))

vi.mock('../frameEngine', () => ({
  frameEngine: { onFrame: frameEngineMock.onFrame },
}))

import { frameTelemetry } from './frameTelemetry'

function emitFrame(stats: TestFrameStats): void {
  expect(frameEngineMock.listener).not.toBeNull()
  frameEngineMock.listener?.(stats)
}

describe('frameTelemetry snapshot', () => {
  beforeEach(() => {
    frameTelemetry.stop()
    frameEngineMock.listener = null
    frameEngineMock.onFrame.mockClear()
    frameEngineMock.unsubscribe.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    frameTelemetry.stop()
    vi.useRealTimers()
  })

  it('does not expose synthetic defaults before the first sample', () => {
    frameTelemetry.start('balanced')

    expect(frameTelemetry.snapshot()).toEqual({
      available: false,
      lastSampleAt: null,
      fps: null,
      frameTimeEmaMs: null,
      p95FrameTimeMs: null,
      jankCount: null,
    })
  })

  it('exposes the first real sample and its timestamp', () => {
    frameTelemetry.start('balanced', undefined, { frameHistorySize: 4 })

    emitFrame({
      fps: 42,
      frameTimeEma: 24,
      jankCount: 3,
      lastFrameTime: 30,
    })

    expect(frameTelemetry.snapshot()).toEqual({
      available: true,
      lastSampleAt: 1_000_000,
      fps: 42,
      frameTimeEmaMs: 24,
      p95FrameTimeMs: 24,
      jankCount: 3,
    })
  })

  it('resets availability when a new collection lifecycle starts', () => {
    frameTelemetry.start('balanced')
    emitFrame({
      fps: 55,
      frameTimeEma: 18,
      jankCount: 0,
      lastFrameTime: 19,
    })

    frameTelemetry.stop()
    frameTelemetry.start('high')

    expect(frameTelemetry.snapshot().available).toBe(false)
    expect(frameTelemetry.snapshot().lastSampleAt).toBeNull()
  })
})

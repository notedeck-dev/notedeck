import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TestStreamState =
  | 'initializing'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

const metricsMock = vi.hoisted(() => ({
  frame: {
    available: false,
    lastSampleAt: null as number | null,
    sampleCount: 0,
    frameBudgetMs: 16.6,
    fps: null as number | null,
    frameTimeEmaMs: null as number | null,
    p95FrameTimeMs: null as number | null,
    jankCount: null as number | null,
  },
  currentQuality: 'balanced',
  autoAdjustEnabled: true,
  streams: [] as Array<{
    accountId: string
    state: TestStreamState
    since: number
  }>,
  manualOffline: false,
}))

vi.mock('@/engine/telemetry/frameTelemetry', () => ({
  frameTelemetry: {
    snapshot: () => ({ ...metricsMock.frame }),
    currentQuality: {
      get value() {
        return metricsMock.currentQuality
      },
    },
    autoAdjustEnabled: {
      get value() {
        return metricsMock.autoAdjustEnabled
      },
    },
  },
}))

// listStreamHealth だけ差し替え、summarizeStreamHealth は実物を通す
vi.mock('@/core/streamHealth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/streamHealth')>()),
  listStreamHealth: () => metricsMock.streams,
}))

vi.mock('@/stores/offlineMode', () => ({
  useOfflineModeStore: () => ({
    get isOfflineMode() {
      return metricsMock.manualOffline
    },
  }),
}))

import { METRICS_BUILTIN_CAPABILITIES, metricsReadCapability } from './metrics'

describe('metrics.read', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
    metricsMock.frame = {
      available: false,
      lastSampleAt: null,
      sampleCount: 0,
      frameBudgetMs: 16.6,
      fps: null,
      frameTimeEmaMs: null,
      p95FrameTimeMs: null,
      jankCount: null,
    }
    metricsMock.currentQuality = 'balanced'
    metricsMock.autoAdjustEnabled = true
    metricsMock.streams = []
    metricsMock.manualOffline = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is a read-only AI capability gated by deck.read', () => {
    expect(metricsReadCapability.id).toBe('metrics.read')
    // external principal はデフォルトで deck.read を持たないため、
    // /api/capabilities/{id}/execute 経由の外部トークンには開かない
    // (/api/health が streams 詳細を deck.read で隠すのと同じ境界)
    expect(metricsReadCapability.permissions).toEqual(['deck.read'])
    expect(metricsReadCapability.aiTool).toBe(true)
    // payload が capturedAt / EMA など毎回変わる値を含むため、HEARTBEAT の
    // Cheap Check (結果の文字列比較) には使えない = cheap を宣言しない
    expect(metricsReadCapability.signature?.cheap).toBeUndefined()
    expect(metricsReadCapability.signature?.returns?.type).toBe('object')
    expect(METRICS_BUILTIN_CAPABILITIES).toEqual([metricsReadCapability])
  })

  it('keeps unavailable frame values distinct from healthy measurements', () => {
    expect(metricsReadCapability.execute()).toEqual({
      schemaVersion: 1,
      capturedAt: 2_000_000,
      frame: {
        available: false,
        lastSampleAt: null,
        sampleCount: 0,
        frameBudgetMs: 16.6,
        fps: null,
        frameTimeEmaMs: null,
        p95FrameTimeMs: null,
        jankCount: null,
      },
      adaptiveQuality: {
        currentLevel: 'balanced',
        autoAdjustEnabled: true,
      },
      streaming: {
        observedConnectionCount: 0,
        byState: {
          initializing: 0,
          connected: 0,
          reconnecting: 0,
          disconnected: 0,
        },
        overallHealth: 'unknown',
        lastTransitionAt: null,
      },
    })
  })

  it('returns measured frame values and current adaptive quality', () => {
    metricsMock.frame = {
      available: true,
      lastSampleAt: 1_999_000,
      sampleCount: 42,
      frameBudgetMs: 16.6,
      fps: 48,
      frameTimeEmaMs: 21,
      p95FrameTimeMs: 29,
      jankCount: 2,
    }
    metricsMock.currentQuality = 'low'
    metricsMock.autoAdjustEnabled = false

    const result = metricsReadCapability.execute() as {
      frame: typeof metricsMock.frame
      adaptiveQuality: Record<string, unknown>
    }

    expect(result.frame).toEqual(metricsMock.frame)
    expect(result.adaptiveQuality).toEqual({
      currentLevel: 'low',
      autoAdjustEnabled: false,
    })
  })

  it('aggregates stream states without exposing account identifiers', () => {
    metricsMock.streams = [
      { accountId: 'private-account-a', state: 'connected', since: 1_900_000 },
      {
        accountId: 'private-account-b',
        state: 'reconnecting',
        since: 1_950_000,
      },
      {
        accountId: 'private-account-c',
        state: 'disconnected',
        since: 1_925_000,
      },
    ]

    const result = metricsReadCapability.execute() as {
      streaming: Record<string, unknown>
    }

    expect(result.streaming).toEqual({
      observedConnectionCount: 3,
      byState: {
        initializing: 0,
        connected: 1,
        reconnecting: 1,
        disconnected: 1,
      },
      overallHealth: 'degraded',
      lastTransitionAt: 1_950_000,
    })
    expect(JSON.stringify(result)).not.toContain('accountId')
    expect(JSON.stringify(result)).not.toContain('private-account')
  })

  it('distinguishes an intentional offline mode from a connection failure', () => {
    metricsMock.streams = [
      {
        accountId: 'private-account-a',
        state: 'disconnected',
        since: 1_900_000,
      },
    ]

    const failed = metricsReadCapability.execute() as {
      streaming: { overallHealth: string }
    }
    expect(failed.streaming.overallHealth).toBe('offline')

    metricsMock.manualOffline = true
    const intentional = metricsReadCapability.execute() as {
      streaming: { overallHealth: string }
    }
    expect(intentional.streaming.overallHealth).toBe('manual-offline')
  })

  it.each([
    ['initializing', ['initializing'], 'initializing'],
    ['healthy', ['connected', 'connected'], 'healthy'],
  ] as const)('reports %s aggregate health', (_name, states, expected) => {
    metricsMock.streams = states.map((state, index) => ({
      accountId: `private-account-${index}`,
      state,
      since: 1_900_000 + index,
    }))

    const result = metricsReadCapability.execute() as {
      streaming: { overallHealth: string }
    }
    expect(result.streaming.overallHealth).toBe(expected)
  })
})

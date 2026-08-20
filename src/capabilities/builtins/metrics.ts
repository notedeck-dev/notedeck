import type { StreamConnectionState } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { listStreamHealth, type StreamHealth } from '@/core/streamHealth'
import { frameTelemetry } from '@/engine/telemetry/frameTelemetry'
import { useOfflineModeStore } from '@/stores/offlineMode'

type OverallStreamHealth =
  | 'unknown'
  | 'initializing'
  | 'healthy'
  | 'degraded'
  | 'offline'
  | 'manual-offline'

interface StreamingMetricsSnapshot {
  observedConnectionCount: number
  byState: Record<StreamConnectionState, number>
  overallHealth: OverallStreamHealth
  lastTransitionAt: number | null
}

function buildStreamingSnapshot(
  streams: readonly StreamHealth[],
  manualOffline: boolean,
): StreamingMetricsSnapshot {
  const byState: Record<StreamConnectionState, number> = {
    initializing: 0,
    connected: 0,
    reconnecting: 0,
    disconnected: 0,
  }
  let lastTransitionAt: number | null = null

  for (const stream of streams) {
    byState[stream.state]++
    lastTransitionAt = Math.max(lastTransitionAt ?? stream.since, stream.since)
  }

  const observedConnectionCount = streams.length
  let overallHealth: OverallStreamHealth
  if (manualOffline) {
    overallHealth = 'manual-offline'
  } else if (observedConnectionCount === 0) {
    overallHealth = 'unknown'
  } else if (byState.connected === observedConnectionCount) {
    overallHealth = 'healthy'
  } else if (byState.disconnected === observedConnectionCount) {
    overallHealth = 'offline'
  } else if (byState.reconnecting > 0 || byState.disconnected > 0) {
    overallHealth = 'degraded'
  } else {
    overallHealth = 'initializing'
  }

  return {
    observedConnectionCount,
    byState,
    overallHealth,
    lastTransitionAt,
  }
}

export const metricsReadCapability: Command = {
  id: 'metrics.read',
  label: '実行時メトリクスを取得',
  icon: 'ti-activity',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在の Frame Engine 実測値、適応品質、WebSocket 接続状態の匿名集約を ' +
      'point-in-time snapshot として返す。frame.available=false の間は未計測で、' +
      '数値は null。アカウント識別子や認証情報は含まない。',
    params: {},
    returns: {
      type: 'object',
      description:
        '{ schemaVersion, capturedAt, frame: { available, lastSampleAt, fps, ' +
        'frameTimeEmaMs, p95FrameTimeMs, jankCount }, adaptiveQuality: { ' +
        'currentLevel, autoAdjustEnabled }, streaming: { observedConnectionCount, ' +
        'byState, overallHealth, lastTransitionAt } }。時刻は epoch ms。',
    },
    cheap: true,
  },
  visible: false,
  execute: () => ({
    schemaVersion: 1 as const,
    capturedAt: Date.now(),
    frame: frameTelemetry.snapshot(),
    adaptiveQuality: {
      currentLevel: frameTelemetry.currentQuality.value,
      autoAdjustEnabled: frameTelemetry.autoAdjustEnabled.value,
    },
    streaming: buildStreamingSnapshot(
      listStreamHealth(),
      useOfflineModeStore().isOfflineMode,
    ),
  }),
}

export const METRICS_BUILTIN_CAPABILITIES: readonly Command[] = [
  metricsReadCapability,
]

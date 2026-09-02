import type { Command } from '@/commands/registry'
import { listStreamHealth, summarizeStreamHealth } from '@/core/streamHealth'
import { frameTelemetry } from '@/engine/telemetry/frameTelemetry'
import { useOfflineModeStore } from '@/stores/offlineMode'

export const metricsReadCapability: Command = {
  id: 'metrics.read',
  label: '実行時メトリクスを取得',
  icon: 'ti-activity',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  // streaming セクションは接続数 (= アカウント数の cardinality) や切断時刻を
  // 含むため、/api/health が streams 詳細を隠すのと同じ deck.read で gate する
  permissions: ['deck.read'],
  signature: {
    description:
      '現在の Frame Engine 実測値、適応品質、WebSocket 接続状態の匿名集約を ' +
      'point-in-time snapshot として返す。フレームサンプリングはアイドル時 ' +
      '(描画作業なし) に停止するため、frame.available=false の間は数値が null ' +
      '(未計測またはアイドル)。アカウント識別子や認証情報は含まない。',
    params: {},
    returns: {
      type: 'object',
      description:
        '{ schemaVersion, capturedAt, frame: { available, lastSampleAt, ' +
        'sampleCount, fps, frameTimeEmaMs, p95FrameTimeMs, jankCount }, ' +
        'adaptiveQuality: { currentLevel, autoAdjustEnabled }, streaming: { ' +
        'observedConnectionCount, byState, overallHealth, lastTransitionAt } }。' +
        '時刻は epoch ms。fps は直近 1 秒に描画作業を実行した frame 数で、' +
        '画面リフレッシュレートではない。p95FrameTimeMs は sampleCount が' +
        '小さい間 (起動直後) はサンプル最大値に寄る。overallHealth は ' +
        'unknown | initializing | healthy | degraded | offline | ' +
        'manual-offline (manual-offline はユーザーが意図したオフラインモード)。',
    },
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
    streaming: summarizeStreamHealth(
      listStreamHealth(),
      useOfflineModeStore().isOfflineMode,
    ),
  }),
}

export const METRICS_BUILTIN_CAPABILITIES: readonly Command[] = [
  metricsReadCapability,
]

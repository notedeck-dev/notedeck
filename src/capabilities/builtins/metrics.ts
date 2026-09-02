import type { Command } from '@/commands/registry'
import {
  listStreamHealth,
  type StreamHealthSummary,
  summarizeStreamHealth,
} from '@/core/streamHealth'
import {
  type FrameTelemetrySnapshot,
  frameTelemetry,
  type QualityLevel,
} from '@/engine/telemetry/frameTelemetry'
import {
  estimateImageMemory,
  type ImageMemoryEstimate,
} from '@/services/imageMemory'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { getStartupEntries, getWebviewFixedCost } from '@/utils/startupTrace'

/**
 * 起動クリティカルパスの内訳 (#985 結線)。About の起動パフォーマンス
 * セクションと同じ計測点 (startupTrace) を読む。セッション中は不変。
 */
export interface StartupMetrics {
  /**
   * WebView 起動固定費 (プロセス起動 → navigation 開始) の ms。
   * リロード後は計測不能で null (phases は navigation 起点のまま有効)
   */
  webviewFixedCostMs: number | null
  /** 各フェーズの到達時刻 (navigation 起点 ms)。時刻順 */
  phases: Array<{ name: string; atMs: number }>
}

/**
 * フロントから正しく取れる範囲のメモリ指標 (#732 / #991)。
 * プロセス全体の専有メモリ (Private) は WebView 子プロセス群の合算が
 * 必要なためここには含まない — OS 側で Private を見る (Working Set は
 * 共有ライブラリの二重計上で使わない、#991)。
 */
export interface MemoryMetrics {
  /** JS ヒープ。Chromium 系 WebView のみ取得可能で、WebKit では null */
  jsHeap: { usedBytes: number; totalBytes: number } | null
  /** デコード済みリモート画像の推定 (ユニーク URL 単位) */
  images: ImageMemoryEstimate
}

/** metrics.read の返り値。About ウィンドウも同じ snapshot を表示する。 */
export interface MetricsSnapshot {
  schemaVersion: 1
  capturedAt: number
  frame: FrameTelemetrySnapshot
  adaptiveQuality: {
    currentLevel: QualityLevel
    autoAdjustEnabled: boolean
  }
  streaming: StreamHealthSummary
  startup: StartupMetrics
  memory: MemoryMetrics
}

function readJsHeap(): MemoryMetrics['jsHeap'] {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
    }
  ).memory
  if (!memory) return null
  return {
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
  }
}

/** 同梱資産をリモート画像として誤計上しない (#991 で実例のある罠) */
function isLocalAssetUrl(url: string): boolean {
  return (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith(location.origin)
  )
}

function readImageMemory(): ImageMemoryEstimate {
  // テスト環境 (node) では DOM がない
  if (typeof document === 'undefined') {
    return { elementCount: 0, uniqueCount: 0, estimatedDecodedBytes: 0 }
  }
  return estimateImageMemory(document.images, isLocalAssetUrl)
}

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
      '現在の Frame Engine 実測値、適応品質、WebSocket 接続状態の匿名集約、' +
      '起動フェーズ内訳、メモリ指標を point-in-time snapshot として返す。' +
      'フレームサンプリングはアイドル時 (描画作業なし) に停止するため、' +
      'frame.available=false の間は数値が null (未計測またはアイドル)。' +
      'アカウント識別子や認証情報は含まない。',
    params: {},
    returns: {
      type: 'object',
      description:
        '{ schemaVersion, capturedAt, frame: { available, lastSampleAt, ' +
        'sampleCount, frameBudgetMs, fps, frameTimeEmaMs, p95FrameTimeMs, ' +
        'jankCount }, adaptiveQuality: { currentLevel, autoAdjustEnabled }, ' +
        'streaming: { observedConnectionCount, byState, overallHealth, ' +
        'lastTransitionAt }, startup: { webviewFixedCostMs, phases: ' +
        '[{ name, atMs }] }, memory: { jsHeap: { usedBytes, totalBytes } | ' +
        'null, images: { elementCount, uniqueCount, estimatedDecodedBytes } } }。' +
        '時刻は epoch ms。frameBudgetMs は 1 フレームの時間予算 ' +
        '(1000/リフレッシュレート) で、jank はその 2 倍超のフレーム数/秒。' +
        'fps は直近 1 秒に描画作業を実行した frame 数で、' +
        '画面リフレッシュレートではない。p95FrameTimeMs は sampleCount が' +
        '小さい間 (起動直後) はサンプル最大値に寄る。overallHealth は ' +
        'unknown | initializing | healthy | degraded | offline | ' +
        'manual-offline (manual-offline はユーザーが意図したオフラインモード)。' +
        'startup はセッション中不変の起動計測 (atMs は navigation 起点、' +
        'webviewFixedCostMs はプロセス起動→navigation でリロード後は null)。' +
        'memory.jsHeap は Chromium 系 WebView のみ (WebKit は null)。' +
        'memory.images はリモート画像のユニーク URL 単位のデコード済み推定 ' +
        '(W×H×4)。プロセス全体の専有メモリは含まない。',
    },
  },
  visible: false,
  execute: (): MetricsSnapshot => ({
    schemaVersion: 1,
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
    startup: {
      webviewFixedCostMs: getWebviewFixedCost(),
      phases: getStartupEntries().map((e) => ({
        name: e.name,
        atMs: Math.round(e.at),
      })),
    },
    memory: {
      jsHeap: readJsHeap(),
      images: readImageMemory(),
    },
  }),
}

export const METRICS_BUILTIN_CAPABILITIES: readonly Command[] = [
  metricsReadCapability,
]

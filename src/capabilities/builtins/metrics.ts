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
  isLocalAssetUrl,
} from '@/services/imageMemory'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { getStartupEntries, getWebviewFixedCost } from '@/utils/startupTrace'
import { implement } from '../declare'

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

function readImageMemory(): ImageMemoryEstimate {
  // テスト環境 (node) では DOM がない
  if (typeof document === 'undefined') {
    return { elementCount: 0, uniqueCount: 0, estimatedDecodedBytes: 0 }
  }
  return estimateImageMemory(document.images, (url) =>
    isLocalAssetUrl(url, location.origin),
  )
}

export const metricsReadCapability = implement('metrics.read', {
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
})

export const METRICS_BUILTIN_CAPABILITIES: readonly Command[] = [
  metricsReadCapability,
]

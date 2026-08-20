/**
 * Frame Telemetry — 継続的パフォーマンス監視と自動品質調整。
 *
 * Frame Engine から毎秒フレーム統計を受信し、以下を行う:
 * - P95 フレーム時間の追跡
 * - Jank 連続検出による品質自動ダウングレード
 * - 安定時の品質アップグレード試行
 * - Performance Store との双方向連携
 */

import { readonly, ref } from 'vue'
import { type FrameStats, frameEngine } from '../frameEngine'

export type QualityLevel = 'low' | 'balanced' | 'high'

export interface FrameTelemetrySnapshot {
  available: boolean
  /** Last real Frame Engine sample time (epoch ms). */
  lastSampleAt: number | null
  fps: number | null
  frameTimeEmaMs: number | null
  p95FrameTimeMs: number | null
  jankCount: number | null
}

/** Default thresholds for automatic quality adjustment. */
const DEFAULT_JANK_DOWNGRADE_THRESHOLD = 5
const DEFAULT_STABLE_UPGRADE_SECONDS = 10
const FRAME_HISTORY_SIZE = 100 // ring buffer for P95 calculation

const QUALITY_ORDER: QualityLevel[] = ['low', 'balanced', 'high']

class FrameTelemetryImpl {
  // --- Reactive state (exposed as readonly refs) ---
  private _fps = ref(60)
  private _frameTimeEma = ref(16.6)
  private _p95FrameTime = ref(16.6)
  private _jankCount = ref(0)
  private _lastSampleAt = ref<number | null>(null)
  private _currentQuality = ref<QualityLevel>('balanced')
  private _autoAdjustEnabled = ref(true)

  // --- Internal state ---
  private _frameTimeHistory: number[] = []
  private _historyIndex = 0
  private _stableSeconds = 0
  private _historySize = FRAME_HISTORY_SIZE
  private _unsubscribe: (() => void) | null = null
  private _onQualityChange: ((quality: QualityLevel) => void) | null = null
  private _jankThreshold = DEFAULT_JANK_DOWNGRADE_THRESHOLD
  private _stableTarget = DEFAULT_STABLE_UPGRADE_SECONDS

  // --- Public readonly refs ---
  readonly fps = readonly(this._fps)
  readonly frameTimeEma = readonly(this._frameTimeEma)
  readonly p95FrameTime = readonly(this._p95FrameTime)
  readonly jankCount = readonly(this._jankCount)
  readonly lastSampleAt = readonly(this._lastSampleAt)
  readonly currentQuality = readonly(this._currentQuality)
  readonly autoAdjustEnabled = readonly(this._autoAdjustEnabled)

  /**
   * Start telemetry collection.
   * @param initialQuality - Current quality from Performance Store
   * @param onQualityChange - Callback when auto-adjustment changes quality
   */
  start(
    initialQuality: QualityLevel,
    onQualityChange?: (quality: QualityLevel) => void,
    options?: {
      jankDowngradeThreshold?: number
      stableUpgradeSeconds?: number
      frameHistorySize?: number
    },
  ): void {
    this._jankThreshold =
      options?.jankDowngradeThreshold ?? DEFAULT_JANK_DOWNGRADE_THRESHOLD
    this._stableTarget =
      options?.stableUpgradeSeconds ?? DEFAULT_STABLE_UPGRADE_SECONDS
    this._historySize = options?.frameHistorySize ?? FRAME_HISTORY_SIZE
    this._currentQuality.value = initialQuality
    this._onQualityChange = onQualityChange ?? null
    this._frameTimeHistory = []
    this._historyIndex = 0
    this._stableSeconds = 0
    this._lastSampleAt.value = null

    this._unsubscribe = frameEngine.onFrame((stats) => this._handleFrame(stats))
  }

  /**
   * Stop telemetry collection.
   */
  stop(): void {
    this._unsubscribe?.()
    this._unsubscribe = null
  }

  /**
   * Enable/disable automatic quality adjustment.
   */
  setAutoAdjust(enabled: boolean): void {
    this._autoAdjustEnabled.value = enabled
    this._stableSeconds = 0
  }

  /**
   * Manually set quality (e.g., from user preset selection).
   */
  setQuality(quality: QualityLevel): void {
    this._currentQuality.value = quality
    this._stableSeconds = 0
  }

  /** Return only measured frame values; defaults remain internal until sampled. */
  snapshot(): FrameTelemetrySnapshot {
    const available = this._lastSampleAt.value !== null
    return {
      available,
      lastSampleAt: this._lastSampleAt.value,
      fps: available ? this._fps.value : null,
      frameTimeEmaMs: available ? this._frameTimeEma.value : null,
      p95FrameTimeMs: available ? this._p95FrameTime.value : null,
      jankCount: available ? this._jankCount.value : null,
    }
  }

  private _handleFrame(stats: FrameStats): void {
    // Update reactive state
    this._fps.value = stats.fps
    this._frameTimeEma.value = stats.frameTimeEma
    this._jankCount.value = stats.jankCount

    // Record frame time in ring buffer
    if (this._frameTimeHistory.length < this._historySize) {
      this._frameTimeHistory.push(stats.frameTimeEma)
    } else {
      this._frameTimeHistory[this._historyIndex] = stats.frameTimeEma
      this._historyIndex = (this._historyIndex + 1) % this._historySize
    }

    // Calculate P95
    this._p95FrameTime.value = this._calculateP95()
    this._lastSampleAt.value = Date.now()

    // Auto quality adjustment
    if (this._autoAdjustEnabled.value) {
      this._evaluateQuality(stats)
    }
  }

  /** Scratch buffer for P95 calculation — reused to avoid allocation per call. */
  private _p95Scratch: number[] = []

  private _calculateP95(): number {
    const src = this._frameTimeHistory
    const len = src.length
    if (len === 0) return 16.6
    const k = Math.floor(len * 0.95)
    // Reuse scratch buffer to avoid allocating a new array every second
    const buf = this._p95Scratch
    buf.length = len
    for (let i = 0; i < len; i++) buf[i] = src[i] ?? 16.6
    // Partial quickselect — O(n) average instead of O(n log n) full sort
    quickselect(buf, k, 0, len - 1)
    return buf[k] ?? 16.6
  }

  private _evaluateQuality(stats: FrameStats): void {
    const currentIdx = QUALITY_ORDER.indexOf(this._currentQuality.value)

    // Downgrade: too many janks
    if (stats.jankCount > this._jankThreshold && currentIdx > 0) {
      const newQuality = QUALITY_ORDER[currentIdx - 1]
      if (newQuality) {
        this._currentQuality.value = newQuality
        this._stableSeconds = 0
        this._onQualityChange?.(newQuality)
      }
      return
    }

    // Upgrade: stable for N seconds
    if (stats.jankCount === 0) {
      this._stableSeconds++
      if (
        this._stableSeconds >= this._stableTarget &&
        currentIdx < QUALITY_ORDER.length - 1
      ) {
        const newQuality = QUALITY_ORDER[currentIdx + 1]
        if (newQuality) {
          this._currentQuality.value = newQuality
          this._stableSeconds = 0
          this._onQualityChange?.(newQuality)
        }
      }
    } else {
      this._stableSeconds = 0
    }
  }
}

/** In-place partial sort: after return, arr[k] holds the k-th smallest value.
 *  Average O(n), worst O(n²) — fine for small buffers (100–500 elements). */
function quickselect(arr: number[], k: number, lo: number, hi: number): void {
  while (lo < hi) {
    const pivot = arr[lo + ((hi - lo) >> 1)] ?? 0
    let i = lo
    let j = hi
    while (i <= j) {
      while ((arr[i] ?? 0) < pivot) i++
      while ((arr[j] ?? 0) > pivot) j--
      if (i <= j) {
        const tmp = arr[i] ?? 0
        arr[i] = arr[j] ?? 0
        arr[j] = tmp
        i++
        j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else return
  }
}

/** Singleton telemetry instance. */
export const frameTelemetry = new FrameTelemetryImpl()

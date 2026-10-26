/**
 * Adaptive Quality — デバイス性能に応じたパフォーマンスプリセット推奨。
 *
 * ゲームエンジンの「自動画質調整」を Web に適用。
 * 検出結果は推奨のみ — 自動適用はしない（ユーザーが設定 UI で確認）。
 * navigator / matchMedia を読む platform glue なので utils に置く (#1098)。
 */
export type QualityPreset = 'low' | 'balanced' | 'high'

interface DeviceSignals {
  cores: number
  memoryGB: number | undefined
  prefersReducedMotion: boolean
}

function readDeviceSignals(): DeviceSignals {
  return {
    cores: navigator.hardwareConcurrency ?? 2,
    memoryGB: (navigator as { deviceMemory?: number }).deviceMemory,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches,
  }
}

/**
 * 静的シグナル（CPU コア数、メモリ）のみで即座に推奨を返す。
 */
export function detectQualitySync(): QualityPreset {
  const signals = readDeviceSignals()

  if (signals.prefersReducedMotion) return 'low'
  if (signals.cores <= 2) return 'low'
  if (signals.memoryGB !== undefined && signals.memoryGB <= 2) return 'low'
  if (signals.cores >= 8) return 'high'
  if (signals.memoryGB !== undefined && signals.memoryGB >= 8) return 'high'
  return 'balanced'
}

/**
 * frameTelemetry の EMA フレーム時間から品質を推奨する。
 * init() で telemetry が安定した後に呼ぶ。
 */
export function detectQualityFromEma(frameTimeEma: number): QualityPreset {
  const sync = detectQualitySync()

  // prefers-reduced-motion は最優先
  if (sync === 'low') return 'low'

  // 20ms 以上 = 50fps 未満 → low を推奨
  if (frameTimeEma > 20) return 'low'
  // 18ms 以上 = 55fps 前後 → balanced
  if (frameTimeEma > 18) return 'balanced'

  return sync
}

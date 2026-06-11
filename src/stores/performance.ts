import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { detectQualitySync } from '@/composables/useAdaptiveQuality'
import { frameEngine } from '@/engine/frameEngine'
import {
  frameTelemetry,
  type QualityLevel,
} from '@/engine/telemetry/frameTelemetry'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { isTauri, readPerformance, writePerformance } from '@/utils/settingsFs'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** All tunable performance keys. */
export interface PerformanceConfig {
  // Emoji cache
  emojiCachePerHost: number
  emojiListHosts: number
  emojiPersistPerHost: number
  // Notes
  noteStoreMax: number
  noteListMax: number
  maxNotifications: number
  // Chat
  chatMessageStoreMax: number
  // Parse cache
  mfmCacheMax: number
  imageProxyCacheMax: number
  ogpCacheMax: number
  // Realtime
  noteCaptureMax: number
  overscan: number
  prefetchAhead: number
  prefetchBehind: number
  prefetchTrackedMax: number
  lazyLoadMargin: number
  nearViewportBuffer: number
  // Image / OGP
  ogpGalleryMax: number
  embedCacheMax: number
  // CSS rendering
  cssBlurLevel: number
  cssAnimationScale: number
  cssShadowLevel: number
  // Rust: backend
  memoryCacheMaxMB: number
  memoryCacheMaxItemKB: number
  maxConcurrentFetches: number
  rustOgpCacheMax: number
  maxRequestsPerWindow: number
  circuitBreakerThreshold: number
  circuitBreakerDuration: number
  imageCacheTTLDays: number
  // Polling
  streamPollingInterval: number
  notificationPollInterval: number
  chatPollInterval: number
  // Realtime (continued)
  maxLiveColumns: number
  columnUnloadDelay: number
  snapshotMaxNotes: number
  snapshotTTL: number
  // Telemetry
  jankDowngradeThreshold: number
  stableUpgradeSeconds: number
  noteAnimationDuration: number
  frameHistorySize: number
  // Cache (continued)
  soundCacheMax: number
  cachedTimelineLimit: number
  // Interaction
  pullFireThreshold: number
  swipeThreshold: number
  flingVelocity: number
  wheelCooldown: number
  scrollHideThreshold: number
}

export type PerformanceKey = keyof PerformanceConfig

export {
  CATEGORY_LABELS,
  CSS_BASE_DURATIONS,
  DEFAULTS,
  detectSliderPosition,
  FIELD_META,
  type FieldMeta,
  interpolateConfig,
  SLIDER_HIGH,
  SLIDER_LOW,
} from '@/stores/performanceData'

import {
  CSS_BASE_DURATIONS,
  DEFAULTS,
  detectSliderPosition,
  FIELD_META,
  interpolateConfig,
} from '@/stores/performanceData'

export const usePerformanceStore = defineStore('performance', () => {
  /** User overrides (独自 ref — performance.json5 が single source of truth). */
  const overrides = ref<Partial<PerformanceConfig>>({})
  const initialized = ref(false)

  const { schedule: schedulePersist } = createDebouncedPersist(persist, {
    onError: (e) => console.warn('[performance] persist failed:', e),
  })

  async function persist(): Promise<void> {
    if (!isTauri) return
    const content = JSON5.stringify(overrides.value, null, 2)
    await writePerformance(`${content}\n`)
  }
  /** Merged config: overrides on top of defaults. */
  const config = computed<PerformanceConfig>(() => ({
    ...DEFAULTS,
    ...overrides.value,
  }))

  /** Get a single value (reactive). */
  function get<K extends PerformanceKey>(key: K): PerformanceConfig[K] {
    return config.value[key]
  }

  /** Get the default value for a key. */
  function getDefault<K extends PerformanceKey>(key: K): PerformanceConfig[K] {
    return DEFAULTS[key]
  }

  /** Apply CSS-related config values to :root custom properties. */
  function syncCssProperties(): void {
    if (typeof document === 'undefined') return
    const s = document.documentElement.style
    const c = config.value

    // --- Blur ---
    switch (c.cssBlurLevel) {
      case 0:
        s.setProperty('--nd-blur', '0px')
        s.setProperty('--nd-blur-panel', '0px')
        s.setProperty('--nd-blur-content', '0px')
        s.setProperty('--nd-vibrancy', 'none')
        s.setProperty('--nd-vibrancy-panel', 'none')
        s.setProperty('--nd-vibrancy-content', 'none')
        break
      case 2:
        s.setProperty('--nd-blur', '4px')
        s.setProperty('--nd-blur-panel', '2px')
        s.setProperty('--nd-blur-content', '2px')
        s.setProperty('--nd-vibrancy', 'blur(4px)')
        s.setProperty('--nd-vibrancy-panel', 'blur(2px)')
        s.setProperty('--nd-vibrancy-content', 'blur(2px)')
        break
      default: // 1 = global.css defaults
        for (const p of [
          '--nd-blur',
          '--nd-blur-panel',
          '--nd-blur-content',
          '--nd-vibrancy',
          '--nd-vibrancy-panel',
          '--nd-vibrancy-content',
        ])
          s.removeProperty(p)
    }

    // --- Shadow ---
    switch (c.cssShadowLevel) {
      case 0:
        s.setProperty('--nd-shadow-s', 'none')
        s.setProperty('--nd-shadow-m', 'none')
        s.setProperty('--nd-shadow-l', 'none')
        break
      case 1:
        s.setProperty('--nd-shadow-s', '0 1px 4px var(--nd-shadow)')
        s.setProperty('--nd-shadow-m', '0 2px 12px var(--nd-shadow)')
        s.setProperty('--nd-shadow-l', '0 4px 16px var(--nd-shadow)')
        break
      default: // 2 = global.css defaults
        for (const p of ['--nd-shadow-s', '--nd-shadow-m', '--nd-shadow-l'])
          s.removeProperty(p)
    }

    // --- Animation duration scale ---
    const scale = c.cssAnimationScale / 100
    if (scale === 1) {
      for (const p of Object.keys(CSS_BASE_DURATIONS)) s.removeProperty(p)
    } else if (scale === 0) {
      for (const p of Object.keys(CSS_BASE_DURATIONS))
        s.setProperty(p, '0.01ms')
    } else {
      for (const [p, base] of Object.entries(CSS_BASE_DURATIONS))
        s.setProperty(p, `${(base * scale).toFixed(3)}s`)
    }
  }

  /** Apply CSS + Rust side effects after any override change. */
  function applySideEffects(): void {
    syncCssProperties()
    syncToRust().catch((e) =>
      console.warn('[performance] Rust sync failed:', e),
    )
  }

  async function syncToRust(): Promise<void> {
    if (!isTauri) return
    const c = config.value
    unwrap(
      await commands.updatePerformanceConfig({
        memory_cache_max_total: c.memoryCacheMaxMB * 1024 * 1024,
        memory_cache_max_item: c.memoryCacheMaxItemKB * 1024,
        max_concurrent_fetches: c.maxConcurrentFetches,
        rust_ogp_cache_max: c.rustOgpCacheMax,
        max_requests_per_window: c.maxRequestsPerWindow,
        circuit_breaker_threshold: c.circuitBreakerThreshold,
        circuit_breaker_duration: c.circuitBreakerDuration,
        image_cache_ttl_days: c.imageCacheTTLDays,
      }),
    )
  }

  async function initFileStorage(): Promise<void> {
    const content = await readPerformance()
    if (content) {
      try {
        const parsed = JSON5.parse(content) as Partial<PerformanceConfig>
        overrides.value = parsed
      } catch (e) {
        console.warn('[performance] failed to parse performance.json5:', e)
      }
    }
    initialized.value = true
    syncCssProperties()
    // Initial sync to Rust
    syncToRust().catch((e) =>
      console.warn('[performance] initial Rust sync failed:', e),
    )
  }

  async function init(): Promise<void> {
    if (isTauri) {
      await initFileStorage().catch((e) =>
        console.warn('[performance] file storage init failed:', e),
      )
    } else {
      initialized.value = true
    }

    // Apply CSS overrides to :root on startup
    syncCssProperties()

    // --- Frame Engine + Telemetry ---
    frameEngine.start()

    frameTelemetry.start(
      detectQualitySync() as QualityLevel,
      (quality) => {
        // Auto quality adjustment — only change CSS rendering properties
        // (blur, shadow, animation). Never touch cache sizes or note limits,
        // as those are unrelated to frame jank.
        applyCssQuality(quality)
      },
      {
        jankDowngradeThreshold: config.value.jankDowngradeThreshold,
        stableUpgradeSeconds: config.value.stableUpgradeSeconds,
        frameHistorySize: config.value.frameHistorySize,
      },
    )
  }

  function set<K extends PerformanceKey>(key: K, value: PerformanceConfig[K]) {
    const meta = FIELD_META[key]
    const clamped = Math.max(meta.min, Math.min(meta.max, value as number))
    if (clamped === DEFAULTS[key]) {
      const { [key]: _, ...rest } = overrides.value
      overrides.value = rest as Partial<PerformanceConfig>
    } else {
      overrides.value = { ...overrides.value, [key]: clamped }
    }
    schedulePersist()
    applySideEffects()
  }

  function resetKey(key: PerformanceKey) {
    const { [key]: _, ...rest } = overrides.value
    overrides.value = rest as Partial<PerformanceConfig>
    schedulePersist()
    applySideEffects()
  }

  function resetAll() {
    overrides.value = {}
    schedulePersist()
    applySideEffects()
  }

  /** CSS rendering property presets for auto-quality adjustment.
   *  Only blur/shadow/animation — never cache sizes or note limits. */
  const CSS_QUALITY_PRESETS: Record<
    QualityLevel,
    Pick<
      PerformanceConfig,
      'cssBlurLevel' | 'cssAnimationScale' | 'cssShadowLevel'
    >
  > = {
    low: { cssBlurLevel: 0, cssAnimationScale: 50, cssShadowLevel: 1 },
    balanced: {
      cssBlurLevel: DEFAULTS.cssBlurLevel,
      cssAnimationScale: DEFAULTS.cssAnimationScale,
      cssShadowLevel: DEFAULTS.cssShadowLevel,
    },
    high: { cssBlurLevel: 2, cssAnimationScale: 100, cssShadowLevel: 2 },
  }

  /** Apply only CSS rendering properties for auto-quality adjustment. */
  function applyCssQuality(quality: QualityLevel): void {
    const css = CSS_QUALITY_PRESETS[quality]
    const updated = { ...overrides.value }
    for (const [k, v] of Object.entries(css)) {
      const key = k as PerformanceKey
      if (v === DEFAULTS[key]) {
        delete updated[key]
      } else {
        ;(updated as Record<string, number>)[key] = v
      }
    }
    overrides.value = updated
    schedulePersist()
    applySideEffects()
  }

  /** Apply slider position t ∈ [0, 1] — interpolates all values linearly. */
  function applySlider(t: number) {
    const target = interpolateConfig(t)
    const updated: Partial<PerformanceConfig> = {}
    for (const key of Object.keys(DEFAULTS) as PerformanceKey[]) {
      if (target[key] !== DEFAULTS[key]) {
        ;(updated as Record<string, number>)[key] = target[key]
      }
    }
    overrides.value = updated
    schedulePersist()
    applySideEffects()
  }

  /** Current slider position (0–1), or null if config doesn't match any interpolation point. */
  const sliderPosition = computed<number | null>(() => {
    return detectSliderPosition(config.value)
  })

  function isCustomized(key: PerformanceKey): boolean {
    return key in overrides.value
  }

  return {
    overrides,
    config,
    sliderPosition,
    init,
    get,
    getDefault,
    set,
    resetKey,
    resetAll,
    applySlider,
    isCustomized,
  }
})

/**
 * Performance store の静的データ定義。
 * UI メタデータ、プリセット値、補間関数など、store ロジックとは独立した定数群。
 */

import defaultsJson from '@/defaults/performance.json5'
import { i18n } from '@/i18n'
import type { PerformanceConfig, PerformanceKey } from '@/stores/performance'

/** Metadata for each setting (used by the editor UI and validation). */
export interface FieldMeta {
  min: number
  max: number
  step: number
  unit: string
  category: string
  label: string
  description: string
}

export const FIELD_META: Record<PerformanceKey, FieldMeta> = {
  emojiCacheHosts: {
    min: 4,
    max: 200,
    step: 4,
    get unit() {
      return i18n.ts._performanceData.units.hosts
    },
    category: 'emoji',
    get label() {
      return i18n.ts._performanceData.labels.emojiCacheHosts
    },
    get description() {
      return i18n.ts._performanceData.descriptions.emojiCacheHosts
    },
  },
  emojiListHosts: {
    min: 1,
    max: 10,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.hosts
    },
    category: 'emoji',
    get label() {
      return i18n.ts._performanceData.labels.emojiListHosts
    },
    get description() {
      return i18n.ts._performanceData.descriptions.emojiListHosts
    },
  },
  emojiPersistPerHost: {
    min: 50,
    max: 1000,
    step: 50,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'emoji',
    get label() {
      return i18n.ts._performanceData.labels.emojiPersistPerHost
    },
    get description() {
      return i18n.ts._performanceData.descriptions.emojiPersistPerHost
    },
  },
  noteStoreMax: {
    min: 500,
    max: 10000,
    step: 500,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'note',
    get label() {
      return i18n.ts._performanceData.labels.noteStoreMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.noteStoreMax
    },
  },
  noteListMax: {
    min: 50,
    max: 1000,
    step: 50,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'note',
    get label() {
      return i18n.ts._performanceData.labels.noteListMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.noteListMax
    },
  },
  maxNotifications: {
    min: 100,
    max: 1000,
    step: 100,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'note',
    get label() {
      return i18n.ts._performanceData.labels.maxNotifications
    },
    get description() {
      return i18n.ts._performanceData.descriptions.maxNotifications
    },
  },
  chatMessageStoreMax: {
    min: 500,
    max: 50000,
    step: 500,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'note',
    get label() {
      return i18n.ts._performanceData.labels.chatMessageStoreMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.chatMessageStoreMax
    },
  },
  mfmCacheMax: {
    min: 32,
    max: 2048,
    step: 32,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'cache',
    get label() {
      return i18n.ts._performanceData.labels.mfmCacheMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.mfmCacheMax
    },
  },
  blurhashCacheMax: {
    min: 64,
    max: 2048,
    step: 64,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'cache',
    get label() {
      return i18n.ts._performanceData.labels.blurhashCacheMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.blurhashCacheMax
    },
  },
  imageProxyCacheMax: {
    min: 32,
    max: 2048,
    step: 32,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'cache',
    get label() {
      return i18n.ts._performanceData.labels.imageProxyCacheMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.imageProxyCacheMax
    },
  },
  ogpCacheMax: {
    min: 32,
    max: 1024,
    step: 32,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'cache',
    get label() {
      return i18n.ts._performanceData.labels.ogpCacheMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.ogpCacheMax
    },
  },
  noteCaptureMax: {
    min: 10,
    max: 200,
    step: 10,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.noteCaptureMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.noteCaptureMax
    },
  },
  overscan: {
    min: 2,
    max: 20,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.overscan
    },
    get description() {
      return i18n.ts._performanceData.descriptions.overscan
    },
  },
  memoryCacheMaxMB: {
    min: 1,
    max: 64,
    step: 1,
    unit: 'MB',
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.memoryCacheMaxMB
    },
    get description() {
      return i18n.ts._performanceData.descriptions.memoryCacheMaxMB
    },
  },
  memoryCacheMaxItemKB: {
    min: 16,
    max: 512,
    step: 16,
    unit: 'KB',
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.memoryCacheMaxItemKB
    },
    get description() {
      return i18n.ts._performanceData.descriptions.memoryCacheMaxItemKB
    },
  },
  maxConcurrentFetches: {
    min: 5,
    max: 100,
    step: 5,
    get unit() {
      return i18n.ts._performanceData.units.parallel
    },
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.maxConcurrentFetches
    },
    get description() {
      return i18n.ts._performanceData.descriptions.maxConcurrentFetches
    },
  },
  rustOgpCacheMax: {
    min: 16,
    max: 512,
    step: 16,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.rustOgpCacheMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.rustOgpCacheMax
    },
  },
  maxRequestsPerWindow: {
    min: 50,
    max: 500,
    step: 50,
    unit: 'req/min',
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.maxRequestsPerWindow
    },
    get description() {
      return i18n.ts._performanceData.descriptions.maxRequestsPerWindow
    },
  },
  circuitBreakerThreshold: {
    min: 2,
    max: 10,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.times
    },
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.circuitBreakerThreshold
    },
    get description() {
      return i18n.ts._performanceData.descriptions.circuitBreakerThreshold
    },
  },
  circuitBreakerDuration: {
    min: 10,
    max: 300,
    step: 10,
    get unit() {
      return i18n.ts._performanceData.units.seconds
    },
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.circuitBreakerDuration
    },
    get description() {
      return i18n.ts._performanceData.descriptions.circuitBreakerDuration
    },
  },
  imageCacheTTLDays: {
    min: 1,
    max: 30,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.days
    },
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.imageCacheTTLDays
    },
    get description() {
      return i18n.ts._performanceData.descriptions.imageCacheTTLDays
    },
  },
  imageCacheMaxMB: {
    min: 64,
    max: 4096,
    step: 64,
    unit: 'MB',
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.imageCacheMaxMB
    },
    get description() {
      return i18n.ts._performanceData.descriptions.imageCacheMaxMB
    },
  },
  imageCacheMaxFileMB: {
    min: 1,
    max: 128,
    step: 1,
    unit: 'MB',
    category: 'backend',
    get label() {
      return i18n.ts._performanceData.labels.imageCacheMaxFileMB
    },
    get description() {
      return i18n.ts._performanceData.descriptions.imageCacheMaxFileMB
    },
  },
  prefetchAhead: {
    min: 0,
    max: 60,
    step: 5,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.prefetchAhead
    },
    get description() {
      return i18n.ts._performanceData.descriptions.prefetchAhead
    },
  },
  prefetchBehind: {
    min: 0,
    max: 30,
    step: 5,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.prefetchBehind
    },
    get description() {
      return i18n.ts._performanceData.descriptions.prefetchBehind
    },
  },
  prefetchTrackedMax: {
    min: 100,
    max: 2000,
    step: 100,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.prefetchTrackedMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.prefetchTrackedMax
    },
  },
  lazyLoadMargin: {
    min: 0,
    max: 500,
    step: 50,
    unit: 'px',
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.lazyLoadMargin
    },
    get description() {
      return i18n.ts._performanceData.descriptions.lazyLoadMargin
    },
  },
  nearViewportBuffer: {
    min: 1,
    max: 10,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.nearViewportBuffer
    },
    get description() {
      return i18n.ts._performanceData.descriptions.nearViewportBuffer
    },
  },
  ogpGalleryMax: {
    min: 0,
    max: 8,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.images
    },
    category: 'cache',
    get label() {
      return i18n.ts._performanceData.labels.ogpGalleryMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.ogpGalleryMax
    },
  },
  embedCacheMax: {
    min: 16,
    max: 256,
    step: 16,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'cache',
    get label() {
      return i18n.ts._performanceData.labels.embedCacheMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.embedCacheMax
    },
  },
  cssBlurLevel: {
    min: 0,
    max: 2,
    step: 1,
    unit: '',
    category: 'css',
    get label() {
      return i18n.ts._performanceData.labels.cssBlurLevel
    },
    get description() {
      return i18n.ts._performanceData.descriptions.cssBlurLevel
    },
  },
  cssAnimationScale: {
    min: 0,
    max: 100,
    step: 25,
    unit: '%',
    category: 'css',
    get label() {
      return i18n.ts._performanceData.labels.cssAnimationScale
    },
    get description() {
      return i18n.ts._performanceData.descriptions.cssAnimationScale
    },
  },
  cssShadowLevel: {
    min: 0,
    max: 2,
    step: 1,
    unit: '',
    category: 'css',
    get label() {
      return i18n.ts._performanceData.labels.cssShadowLevel
    },
    get description() {
      return i18n.ts._performanceData.descriptions.cssShadowLevel
    },
  },
  streamPollingInterval: {
    min: 3,
    max: 60,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.seconds
    },
    category: 'polling',
    get label() {
      return i18n.ts._performanceData.labels.streamPollingInterval
    },
    get description() {
      return i18n.ts._performanceData.descriptions.streamPollingInterval
    },
  },
  notificationPollInterval: {
    min: 30,
    max: 600,
    step: 30,
    get unit() {
      return i18n.ts._performanceData.units.seconds
    },
    category: 'polling',
    get label() {
      return i18n.ts._performanceData.labels.notificationPollInterval
    },
    get description() {
      return i18n.ts._performanceData.descriptions.notificationPollInterval
    },
  },
  chatPollInterval: {
    min: 30,
    max: 600,
    step: 30,
    get unit() {
      return i18n.ts._performanceData.units.seconds
    },
    category: 'polling',
    get label() {
      return i18n.ts._performanceData.labels.chatPollInterval
    },
    get description() {
      return i18n.ts._performanceData.descriptions.chatPollInterval
    },
  },
  maxLiveColumns: {
    min: 1,
    max: 10,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.columns
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.maxLiveColumns
    },
    get description() {
      return i18n.ts._performanceData.descriptions.maxLiveColumns
    },
  },
  columnUnloadDelay: {
    min: 1000,
    max: 30000,
    step: 1000,
    unit: 'ms',
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.columnUnloadDelay
    },
    get description() {
      return i18n.ts._performanceData.descriptions.columnUnloadDelay
    },
  },
  snapshotMaxNotes: {
    min: 10,
    max: 100,
    step: 10,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.snapshotMaxNotes
    },
    get description() {
      return i18n.ts._performanceData.descriptions.snapshotMaxNotes
    },
  },
  snapshotTTL: {
    min: 1,
    max: 30,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.minutes
    },
    category: 'realtime',
    get label() {
      return i18n.ts._performanceData.labels.snapshotTTL
    },
    get description() {
      return i18n.ts._performanceData.descriptions.snapshotTTL
    },
  },
  jankDowngradeThreshold: {
    min: 1,
    max: 15,
    step: 1,
    get unit() {
      return i18n.ts._performanceData.units.timesPerSecond
    },
    category: 'telemetry',
    get label() {
      return i18n.ts._performanceData.labels.jankDowngradeThreshold
    },
    get description() {
      return i18n.ts._performanceData.descriptions.jankDowngradeThreshold
    },
  },
  stableUpgradeSeconds: {
    min: 5,
    max: 30,
    step: 5,
    get unit() {
      return i18n.ts._performanceData.units.seconds
    },
    category: 'telemetry',
    get label() {
      return i18n.ts._performanceData.labels.stableUpgradeSeconds
    },
    get description() {
      return i18n.ts._performanceData.descriptions.stableUpgradeSeconds
    },
  },
  noteAnimationDuration: {
    min: 0,
    max: 800,
    step: 50,
    unit: 'ms',
    category: 'telemetry',
    get label() {
      return i18n.ts._performanceData.labels.noteAnimationDuration
    },
    get description() {
      return i18n.ts._performanceData.descriptions.noteAnimationDuration
    },
  },
  frameHistorySize: {
    min: 30,
    max: 500,
    step: 10,
    get unit() {
      return i18n.ts._performanceData.units.frames
    },
    category: 'telemetry',
    get label() {
      return i18n.ts._performanceData.labels.frameHistorySize
    },
    get description() {
      return i18n.ts._performanceData.descriptions.frameHistorySize
    },
  },
  soundCacheMax: {
    min: 2,
    max: 32,
    step: 2,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'cache',
    get label() {
      return i18n.ts._performanceData.labels.soundCacheMax
    },
    get description() {
      return i18n.ts._performanceData.descriptions.soundCacheMax
    },
  },
  cachedTimelineLimit: {
    min: 10,
    max: 200,
    step: 10,
    get unit() {
      return i18n.ts._performanceData.units.items
    },
    category: 'cache',
    get label() {
      return i18n.ts._performanceData.labels.cachedTimelineLimit
    },
    get description() {
      return i18n.ts._performanceData.descriptions.cachedTimelineLimit
    },
  },
  pullFireThreshold: {
    min: 80,
    max: 400,
    step: 20,
    unit: 'px',
    category: 'interaction',
    get label() {
      return i18n.ts._performanceData.labels.pullFireThreshold
    },
    get description() {
      return i18n.ts._performanceData.descriptions.pullFireThreshold
    },
  },
  swipeThreshold: {
    min: 20,
    max: 120,
    step: 10,
    unit: 'px',
    category: 'interaction',
    get label() {
      return i18n.ts._performanceData.labels.swipeThreshold
    },
    get description() {
      return i18n.ts._performanceData.descriptions.swipeThreshold
    },
  },
  flingVelocity: {
    min: 0.1,
    max: 1.0,
    step: 0.1,
    unit: 'px/ms',
    category: 'interaction',
    get label() {
      return i18n.ts._performanceData.labels.flingVelocity
    },
    get description() {
      return i18n.ts._performanceData.descriptions.flingVelocity
    },
  },
  wheelCooldown: {
    min: 100,
    max: 1000,
    step: 50,
    unit: 'ms',
    category: 'interaction',
    get label() {
      return i18n.ts._performanceData.labels.wheelCooldown
    },
    get description() {
      return i18n.ts._performanceData.descriptions.wheelCooldown
    },
  },
  scrollHideThreshold: {
    min: 10,
    max: 100,
    step: 10,
    unit: 'px',
    category: 'interaction',
    get label() {
      return i18n.ts._performanceData.labels.scrollHideThreshold
    },
    get description() {
      return i18n.ts._performanceData.descriptions.scrollHideThreshold
    },
  },
}

/** `short` はミキサーのチャンネル名 (幅が狭いので 4 文字程度まで)。 */
export const CATEGORY_LABELS: Record<
  string,
  { label: string; short: string; icon: string }
> = {
  emoji: {
    get label() {
      return i18n.ts._performanceData.categories.emoji.label
    },
    get short() {
      return i18n.ts._common.emoji
    },
    icon: 'ti-mood-smile',
  },
  note: {
    get label() {
      return i18n.ts._common.notes
    },
    get short() {
      return i18n.ts._common.notes
    },
    icon: 'ti-note',
  },
  cache: {
    get label() {
      return i18n.ts._performanceData.categories.cache.label
    },
    get short() {
      return i18n.ts._performanceData.categories.cache.short
    },
    icon: 'ti-database',
  },
  realtime: {
    get label() {
      return i18n.ts._performanceData.categories.realtime.label
    },
    get short() {
      return i18n.ts._performanceData.categories.realtime.short
    },
    icon: 'ti-bolt',
  },
  backend: {
    get label() {
      return i18n.ts._performanceData.categories.backend.label
    },
    get short() {
      return i18n.ts._performanceData.categories.backend.short
    },
    icon: 'ti-server',
  },
  css: {
    get label() {
      return i18n.ts._performanceData.categories.css.label
    },
    get short() {
      return i18n.ts._performanceData.categories.css.short
    },
    icon: 'ti-palette',
  },
  polling: {
    get label() {
      return i18n.ts._common.polling
    },
    get short() {
      return i18n.ts._performanceData.categories.polling.short
    },
    icon: 'ti-refresh',
  },
  telemetry: {
    get label() {
      return i18n.ts._performanceData.categories.telemetry.label
    },
    get short() {
      return i18n.ts._performanceData.categories.telemetry.short
    },
    icon: 'ti-chart-line',
  },
  interaction: {
    get label() {
      return i18n.ts._performanceData.categories.interaction.label
    },
    get short() {
      return i18n.ts._performanceData.categories.interaction.short
    },
    icon: 'ti-hand-finger',
  },
}

/** Preset definitions. */
/** Slider endpoint: t=0 (省メモリ) */
export const SLIDER_LOW: PerformanceConfig = {
  emojiCacheHosts: 8,
  emojiListHosts: 2,
  emojiPersistPerHost: 200,
  noteStoreMax: 800,
  noteListMax: 150,
  maxNotifications: 100,
  chatMessageStoreMax: 2000,
  mfmCacheMax: 128,
  blurhashCacheMax: 128,
  imageProxyCacheMax: 64,
  ogpCacheMax: 128,
  noteCaptureMax: 40,
  overscan: 5,
  memoryCacheMaxMB: 16,
  memoryCacheMaxItemKB: 128,
  maxConcurrentFetches: 15,
  rustOgpCacheMax: 128,
  maxRequestsPerWindow: 100,
  circuitBreakerThreshold: 3,
  circuitBreakerDuration: 90,
  imageCacheTTLDays: 3,
  imageCacheMaxMB: 128,
  imageCacheMaxFileMB: 8,
  prefetchAhead: 15,
  prefetchBehind: 5,
  prefetchTrackedMax: 150,
  lazyLoadMargin: 100,
  nearViewportBuffer: 2,
  ogpGalleryMax: 2,
  embedCacheMax: 16,
  cssBlurLevel: 0,
  cssAnimationScale: 50,
  cssShadowLevel: 1,
  streamPollingInterval: 30,
  notificationPollInterval: 300,
  chatPollInterval: 300,
  maxLiveColumns: 2,
  columnUnloadDelay: 1500,
  snapshotMaxNotes: 15,
  snapshotTTL: 3,
  jankDowngradeThreshold: 3,
  stableUpgradeSeconds: 15,
  noteAnimationDuration: 200,
  frameHistorySize: 30,
  soundCacheMax: 2,
  cachedTimelineLimit: 15,
  pullFireThreshold: 200,
  swipeThreshold: 50,
  flingVelocity: 0.4,
  wheelCooldown: 300,
  scrollHideThreshold: 30,
}

/** Slider endpoint: t=1 (高パフォーマンス) */
export const SLIDER_HIGH: PerformanceConfig = {
  emojiCacheHosts: 64,
  emojiListHosts: 6,
  emojiPersistPerHost: 700,
  noteStoreMax: 3000,
  noteListMax: 300,
  maxNotifications: 500,
  chatMessageStoreMax: 10000,
  mfmCacheMax: 512,
  blurhashCacheMax: 512,
  imageProxyCacheMax: 512,
  ogpCacheMax: 512,
  noteCaptureMax: 150,
  overscan: 10,
  memoryCacheMaxMB: 64,
  memoryCacheMaxItemKB: 256,
  maxConcurrentFetches: 40,
  rustOgpCacheMax: 512,
  maxRequestsPerWindow: 300,
  circuitBreakerThreshold: 5,
  circuitBreakerDuration: 30,
  imageCacheTTLDays: 14,
  imageCacheMaxMB: 2048,
  imageCacheMaxFileMB: 40,
  prefetchAhead: 40,
  prefetchBehind: 15,
  prefetchTrackedMax: 1000,
  lazyLoadMargin: 300,
  nearViewportBuffer: 6,
  ogpGalleryMax: 6,
  embedCacheMax: 128,
  cssBlurLevel: 2,
  cssAnimationScale: 100,
  cssShadowLevel: 2,
  streamPollingInterval: 5,
  notificationPollInterval: 60,
  chatPollInterval: 60,
  maxLiveColumns: 5,
  columnUnloadDelay: 15000,
  snapshotMaxNotes: 80,
  snapshotTTL: 20,
  jankDowngradeThreshold: 8,
  stableUpgradeSeconds: 5,
  noteAnimationDuration: 500,
  frameHistorySize: 200,
  soundCacheMax: 16,
  cachedTimelineLimit: 80,
  pullFireThreshold: 200,
  swipeThreshold: 50,
  flingVelocity: 0.4,
  wheelCooldown: 300,
  scrollHideThreshold: 30,
}

export const DEFAULTS: PerformanceConfig = defaultsJson as PerformanceConfig

export const ALL_KEYS = Object.keys(DEFAULTS) as PerformanceKey[]

/** カテゴリごとの key 一覧 (FIELD_META 由来)。 */
export const CATEGORY_KEYS: Record<string, PerformanceKey[]> = (() => {
  const map: Record<string, PerformanceKey[]> = {}
  for (const key of ALL_KEYS) {
    const cat = FIELD_META[key].category
    const list = map[cat]
    if (list) list.push(key)
    else map[cat] = [key]
  }
  return map
})()

export function categoryKeys(category: string): PerformanceKey[] {
  return CATEGORY_KEYS[category] ?? []
}

/**
 * フェーダーで動かせるカテゴリ。LOW と HIGH が全て同値のカテゴリ
 * (interaction 系の閾値など) は動かしても何も変わらないので除く。
 */
export const FADER_CATEGORIES = Object.keys(CATEGORY_KEYS).filter((cat) =>
  categoryKeys(cat).some((key) => SLIDER_LOW[key] !== SLIDER_HIGH[key]),
)

/**
 * SLIDER_LOW (t=0) と SLIDER_HIGH (t=1) の間を補間する。
 *
 * 件数・MB・ms は桁で効くパラメータなので対数 (幾何) 補間を使う —
 * 線形だと 500〜10000 のようなレンジでスライダー前半の変化が体感できない。
 * 値が下がる向きのキー (ポーリング間隔など) も同じ式でそのまま扱える。
 * 端点に 0 を含むキーだけは対数が定義できないので線形にフォールバックする。
 */
export function interpolateKey(key: PerformanceKey, t: number): number {
  const low = SLIDER_LOW[key]
  const high = SLIDER_HIGH[key]
  const meta = FIELD_META[key]
  const clamp = (v: number) => Math.max(meta.min, Math.min(meta.max, v))
  // 両端は step 丸めを通さない (プリセット値そのものに着地させる)
  if (t <= 0) return clamp(low)
  if (t >= 1) return clamp(high)
  const raw =
    low > 0 && high > 0 ? low * (high / low) ** t : low + (high - low) * t
  return clamp(Math.round(raw / meta.step) * meta.step)
}

/** Interpolate all config values between SLIDER_LOW (t=0) and SLIDER_HIGH (t=1). */
export function interpolateConfig(t: number): PerformanceConfig {
  const result = {} as Record<string, number>
  for (const key of ALL_KEYS) {
    result[key] = interpolateKey(key, t)
  }
  return result as unknown as PerformanceConfig
}

/** 1 カテゴリ分だけを補間した patch を返す。 */
export function interpolateCategory(
  category: string,
  t: number,
): Partial<PerformanceConfig> {
  const patch: Record<string, number> = {}
  for (const key of categoryKeys(category)) {
    patch[key] = interpolateKey(key, t)
  }
  return patch as Partial<PerformanceConfig>
}

/**
 * 与えられた key 群にとって現在値が最も近いフェーダー位置を返す。
 * `exact` は補間結果と完全一致 (= フェーダーで作った値) かどうか。
 * 一致しなくても位置を返すのは、マスターフェーダーが相対移動 (VCA) で
 * 常に動かせるようにするため。
 */
export function detectPosition(
  cfg: PerformanceConfig,
  keys: PerformanceKey[],
): { t: number; exact: boolean } {
  let bestT = 0
  let bestError = Number.POSITIVE_INFINITY
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    let error = 0
    let exact = true
    for (const key of keys) {
      const value = interpolateKey(key, t)
      if (cfg[key] !== value) exact = false
      const span = Math.abs(SLIDER_HIGH[key] - SLIDER_LOW[key]) || 1
      error += Math.abs(cfg[key] - value) / span
    }
    if (exact) return { t, exact: true }
    if (error < bestError) {
      bestError = error
      bestT = t
    }
  }
  return { t: bestT, exact: false }
}

/** Find slider position t ∈ [0,1] that matches config, or null if custom. */
export function detectSliderPosition(cfg: PerformanceConfig): number | null {
  const { t, exact } = detectPosition(cfg, ALL_KEYS)
  return exact ? t : null
}

/** Base durations (seconds) matching global.css :root values. */
export const CSS_BASE_DURATIONS: Record<string, number> = {
  '--nd-duration-fast': 0.15,
  '--nd-duration-base': 0.2,
  '--nd-duration-slow': 0.28,
  '--nd-duration-slower': 0.38,
  '--nd-duration-tl-enter': 0.5,
}

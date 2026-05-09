/**
 * Performance store の静的データ定義。
 * UI メタデータ、プリセット値、補間関数など、store ロジックとは独立した定数群。
 */

import defaultsJson from '@/defaults/performance.json5'
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
  emojiCachePerHost: {
    min: 500,
    max: 10000,
    step: 500,
    unit: '件',
    category: 'emoji',
    label: '絵文字キャッシュ/ホスト',
    description:
      'ホストあたりのカスタム絵文字キャッシュ数。大規模サーバーは5000+の絵文字を持つ',
  },
  emojiListHosts: {
    min: 1,
    max: 10,
    step: 1,
    unit: 'ホスト',
    category: 'emoji',
    label: 'リスト保持ホスト数',
    description: 'リアクションピッカー用の絵文字リストを保持するホスト数',
  },
  emojiPersistPerHost: {
    min: 50,
    max: 1000,
    step: 50,
    unit: '件',
    category: 'emoji',
    label: 'localStorage永続化/ホスト',
    description: 'オフライン時の絵文字解決用にlocalStorageに保存するエントリ数',
  },
  noteStoreMax: {
    min: 500,
    max: 10000,
    step: 500,
    unit: '件',
    category: 'note',
    label: 'ノートストア上限',
    description:
      'グローバルノートストアの保持上限。長時間セッションのメモリ消費に影響',
  },
  noteListMax: {
    min: 50,
    max: 1000,
    step: 50,
    unit: '件',
    category: 'note',
    label: 'DOM表示上限/カラム',
    description: 'カラムあたりのデータ配列上限。超過分はスクロール時に破棄',
  },
  maxNotifications: {
    min: 100,
    max: 1000,
    step: 100,
    unit: '件',
    category: 'note',
    label: '通知保持上限',
    description: '通知カラムに保持する通知の最大数',
  },
  chatMessageStoreMax: {
    min: 500,
    max: 50000,
    step: 500,
    unit: '件',
    category: 'note',
    label: 'チャットメッセージストア上限',
    description:
      'グローバル chatMessageStore の保持上限。長時間チャットしている場合のメモリに影響 (#460)',
  },
  mfmCacheMax: {
    min: 32,
    max: 2048,
    step: 32,
    unit: '件',
    category: 'cache',
    label: 'MFMキャッシュ',
    description: 'MFMパース結果のLRUキャッシュ上限',
  },
  imageProxyCacheMax: {
    min: 32,
    max: 2048,
    step: 32,
    unit: '件',
    category: 'cache',
    label: 'プロキシURLキャッシュ',
    description: 'プロキシURL変換のLRUキャッシュ上限',
  },
  ogpCacheMax: {
    min: 32,
    max: 1024,
    step: 32,
    unit: '件',
    category: 'cache',
    label: 'OGPキャッシュ',
    description: 'OGPプレビューのLRUキャッシュ上限',
  },
  noteCaptureMax: {
    min: 10,
    max: 200,
    step: 10,
    unit: '件',
    category: 'realtime',
    label: 'Note Capture上限',
    description:
      'リアルタイム更新のWebSocket購読数。多いほどリアクション即時反映',
  },
  overscan: {
    min: 2,
    max: 20,
    step: 1,
    unit: '件',
    category: 'realtime',
    label: 'Overscan',
    description:
      'viewport外に余分に描画するノート数。多いほどスクロールが滑らか',
  },
  memoryCacheMaxMB: {
    min: 1,
    max: 64,
    step: 1,
    unit: 'MB',
    category: 'backend',
    label: 'メモリキャッシュ合計',
    description: '画像のインメモリキャッシュ合計サイズ',
  },
  memoryCacheMaxItemKB: {
    min: 16,
    max: 512,
    step: 16,
    unit: 'KB',
    category: 'backend',
    label: '単一ファイル上限',
    description: 'メモリキャッシュに載せる単一ファイルの最大サイズ',
  },
  maxConcurrentFetches: {
    min: 5,
    max: 100,
    step: 5,
    unit: '並列',
    category: 'backend',
    label: '並行フェッチ数',
    description: '画像の同時ダウンロード数',
  },
  rustOgpCacheMax: {
    min: 16,
    max: 512,
    step: 16,
    unit: '件',
    category: 'backend',
    label: 'Rust OGPキャッシュ',
    description: 'Rust側のOGPメタデータLRUキャッシュ上限',
  },
  maxRequestsPerWindow: {
    min: 50,
    max: 500,
    step: 50,
    unit: 'req/min',
    category: 'backend',
    label: 'レート制限',
    description: 'ホストあたりの1分間リクエスト上限',
  },
  circuitBreakerThreshold: {
    min: 2,
    max: 10,
    step: 1,
    unit: '回',
    category: 'backend',
    label: 'サーキットブレーカー閾値',
    description: 'この回数連続失敗でホストを一時遮断',
  },
  circuitBreakerDuration: {
    min: 10,
    max: 300,
    step: 10,
    unit: '秒',
    category: 'backend',
    label: 'サーキットブレーカー期間',
    description: '遮断されたホストの復帰までの待機時間',
  },
  imageCacheTTLDays: {
    min: 1,
    max: 30,
    step: 1,
    unit: '日',
    category: 'backend',
    label: '画像キャッシュ有効期限',
    description: 'ディスク上の画像キャッシュの保持日数',
  },
  prefetchAhead: {
    min: 0,
    max: 60,
    step: 5,
    unit: '件',
    category: 'realtime',
    label: '先読みプリフェッチ',
    description: 'viewport下方向に先読みする画像プリフェッチ数',
  },
  prefetchBehind: {
    min: 0,
    max: 30,
    step: 5,
    unit: '件',
    category: 'realtime',
    label: '後方プリフェッチ',
    description: 'viewport上方向に遡って画像プリフェッチする数',
  },
  prefetchTrackedMax: {
    min: 100,
    max: 2000,
    step: 100,
    unit: '件',
    category: 'realtime',
    label: 'プリフェッチ追跡上限',
    description: 'プリフェッチ済みURLの記憶数。超過すると古い順に破棄',
  },
  lazyLoadMargin: {
    min: 0,
    max: 500,
    step: 50,
    unit: 'px',
    category: 'realtime',
    label: '遅延読み込みマージン',
    description:
      'OGPプレビューや埋め込みノートの読み込みを開始するviewportからの距離',
  },
  nearViewportBuffer: {
    min: 1,
    max: 10,
    step: 1,
    unit: '件',
    category: 'realtime',
    label: 'Viewport近傍バッファ',
    description: 'viewport端から画像をeager読み込みする余裕アイテム数',
  },
  ogpGalleryMax: {
    min: 0,
    max: 8,
    step: 1,
    unit: '枚',
    category: 'cache',
    label: 'OGPギャラリー上限',
    description: 'OGPプレビューのギャラリー画像の最大表示枚数',
  },
  embedCacheMax: {
    min: 16,
    max: 256,
    step: 16,
    unit: '件',
    category: 'cache',
    label: '埋め込みノートキャッシュ',
    description: '埋め込みノートのLRUキャッシュ上限',
  },
  cssBlurLevel: {
    min: 0,
    max: 2,
    step: 1,
    unit: '',
    category: 'css',
    label: 'ブラー強度',
    description:
      'backdrop-filterブラーの強度。0=無効、1=軽量(1–2px)、2=フル(4px)。最もGPU負荷が高い',
  },
  cssAnimationScale: {
    min: 0,
    max: 100,
    step: 25,
    unit: '%',
    category: 'css',
    label: 'アニメーション速度',
    description:
      'トランジション・アニメーションの速度スケール。0%で即時描画、100%で通常速度',
  },
  cssShadowLevel: {
    min: 0,
    max: 2,
    step: 1,
    unit: '',
    category: 'css',
    label: 'シャドウ強度',
    description: 'box-shadowの描画レベル。0=無効、1=軽量、2=フル(Misskey準拠)',
  },
  streamPollingInterval: {
    min: 3,
    max: 60,
    step: 1,
    unit: '秒',
    category: 'polling',
    label: 'ストリームポーリング間隔',
    description:
      'ポーリングモード時のタイムライン更新間隔。短いほどリアルタイムに近い',
  },
  notificationPollInterval: {
    min: 30,
    max: 600,
    step: 30,
    unit: '秒',
    category: 'polling',
    label: '通知ポーリング間隔',
    description:
      '通知未読数の確認間隔。短いほどリアルタイム、長いほどバッテリー節約',
  },
  chatPollInterval: {
    min: 30,
    max: 600,
    step: 30,
    unit: '秒',
    category: 'polling',
    label: 'チャットポーリング間隔',
    description: 'チャット未読の確認間隔',
  },
  maxLiveColumns: {
    min: 1,
    max: 10,
    step: 1,
    unit: '本',
    category: 'realtime',
    label: '同時 live カラム数',
    description:
      'ストリーミング接続を維持するカラムの上限。超過分は一時停止される',
  },
  columnUnloadDelay: {
    min: 1000,
    max: 30000,
    step: 1000,
    unit: 'ms',
    category: 'realtime',
    label: 'カラムアンロード遅延',
    description:
      '画面外カラムをアンマウントするまでの待機時間。短いほどメモリ節約',
  },
  snapshotMaxNotes: {
    min: 10,
    max: 100,
    step: 10,
    unit: '件',
    category: 'realtime',
    label: 'スナップショット保存数',
    description: 'カラムスナップショットに保存するノート数。多いほど復帰が完全',
  },
  snapshotTTL: {
    min: 1,
    max: 30,
    step: 1,
    unit: '分',
    category: 'realtime',
    label: 'スナップショット有効期限',
    description: 'カラムスナップショットの保持期間。期限切れで再フェッチ',
  },
  jankDowngradeThreshold: {
    min: 1,
    max: 15,
    step: 1,
    unit: '回/秒',
    category: 'telemetry',
    label: 'ジャンク検出感度',
    description:
      'この回数/秒を超えるジャンクで自動品質ダウングレード。低いほど敏感',
  },
  stableUpgradeSeconds: {
    min: 5,
    max: 30,
    step: 5,
    unit: '秒',
    category: 'telemetry',
    label: 'アップグレード待機',
    description: '安定がこの秒数続くと自動品質アップグレードを試行',
  },
  noteAnimationDuration: {
    min: 0,
    max: 800,
    step: 50,
    unit: 'ms',
    category: 'telemetry',
    label: 'ノート出現アニメーション',
    description: '新着ノートのスライドインアニメーション時間。0で即時表示',
  },
  frameHistorySize: {
    min: 30,
    max: 500,
    step: 10,
    unit: 'フレーム',
    category: 'telemetry',
    label: 'P95履歴サイズ',
    description:
      'P95フレーム時間計算用のリングバッファサイズ。大きいほど安定するが反応が遅い',
  },
  soundCacheMax: {
    min: 2,
    max: 32,
    step: 2,
    unit: '件',
    category: 'cache',
    label: '通知音キャッシュ',
    description: '通知音のAudioBufferキャッシュ数。多サーバー利用時は増やす',
  },
  cachedTimelineLimit: {
    min: 10,
    max: 200,
    step: 10,
    unit: '件',
    category: 'cache',
    label: 'タイムラインキャッシュ読み込み',
    description: 'カラム復帰時にDBキャッシュから読み込むノート件数',
  },
  pullFireThreshold: {
    min: 80,
    max: 400,
    step: 20,
    unit: 'px',
    category: 'interaction',
    label: 'プルリフレッシュ距離',
    description: 'プルトゥリフレッシュが発火するまでの引っ張り距離',
  },
  swipeThreshold: {
    min: 20,
    max: 120,
    step: 10,
    unit: 'px',
    category: 'interaction',
    label: 'スワイプ切り替え距離',
    description: 'タブ切り替えに必要な最小スワイプ距離',
  },
  flingVelocity: {
    min: 0.1,
    max: 1.0,
    step: 0.1,
    unit: 'px/ms',
    category: 'interaction',
    label: 'フリック速度',
    description: 'この速度以上のフリックで即座にタブ切り替え',
  },
  wheelCooldown: {
    min: 100,
    max: 1000,
    step: 50,
    unit: 'ms',
    category: 'interaction',
    label: 'ホイールクールダウン',
    description: 'マウスホイールによるタブ切り替え後の再発火防止時間',
  },
  scrollHideThreshold: {
    min: 10,
    max: 100,
    step: 10,
    unit: 'px',
    category: 'interaction',
    label: 'ナビバー非表示感度',
    description: 'スクロールでナビバーを非表示にする累積距離。小さいほど敏感',
  },
}

export const CATEGORY_LABELS: Record<string, { label: string; icon: string }> =
  {
    emoji: { label: '絵文字キャッシュ', icon: 'ti-mood-smile' },
    note: { label: 'ノート', icon: 'ti-note' },
    cache: { label: 'パースキャッシュ', icon: 'ti-database' },
    realtime: { label: 'リアルタイム', icon: 'ti-bolt' },
    backend: { label: 'バックエンド', icon: 'ti-server' },
    css: { label: 'CSS描画', icon: 'ti-palette' },
    polling: { label: 'ポーリング', icon: 'ti-refresh' },
    telemetry: { label: 'テレメトリ', icon: 'ti-chart-line' },
    interaction: { label: 'インタラクション', icon: 'ti-hand-finger' },
  }

/** Preset definitions. */
/** Slider endpoint: t=0 (省メモリ) */
export const SLIDER_LOW: PerformanceConfig = {
  emojiCachePerHost: 2000,
  emojiListHosts: 2,
  emojiPersistPerHost: 200,
  noteStoreMax: 800,
  noteListMax: 150,
  maxNotifications: 100,
  chatMessageStoreMax: 2000,
  mfmCacheMax: 128,
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
  emojiCachePerHost: 7000,
  emojiListHosts: 6,
  emojiPersistPerHost: 700,
  noteStoreMax: 3000,
  noteListMax: 300,
  maxNotifications: 500,
  chatMessageStoreMax: 10000,
  mfmCacheMax: 512,
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

/** Interpolate all config values linearly between SLIDER_LOW (t=0) and SLIDER_HIGH (t=1). */
export function interpolateConfig(t: number): PerformanceConfig {
  const result = {} as Record<string, number>
  for (const key of Object.keys(DEFAULTS) as PerformanceKey[]) {
    const low = SLIDER_LOW[key]
    const high = SLIDER_HIGH[key]
    const meta = FIELD_META[key]
    const raw = low + (high - low) * t
    const snapped = Math.round(raw / meta.step) * meta.step
    result[key] = Math.max(meta.min, Math.min(meta.max, snapped))
  }
  return result as unknown as PerformanceConfig
}

/** Find slider position t ∈ [0,1] that matches config, or null if custom. */
export function detectSliderPosition(cfg: PerformanceConfig): number | null {
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    const interp = interpolateConfig(t)
    let match = true
    for (const key of Object.keys(DEFAULTS) as PerformanceKey[]) {
      if (cfg[key] !== interp[key]) {
        match = false
        break
      }
    }
    if (match) return t
  }
  return null
}

/** Base durations (seconds) matching global.css :root values. */
export const CSS_BASE_DURATIONS: Record<string, number> = {
  '--nd-duration-fast': 0.15,
  '--nd-duration-base': 0.2,
  '--nd-duration-slow': 0.28,
  '--nd-duration-slower': 0.38,
  '--nd-duration-tl-enter': 0.5,
}

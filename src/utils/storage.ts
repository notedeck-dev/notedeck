/**
 * Type-safe localStorage helpers with error handling.
 * Centralizes the try-catch + JSON.parse/stringify pattern
 * repeated across multiple stores.
 */

/** Read and parse a JSON value from localStorage. Returns fallback on error or missing key. */
export function getStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw != null) return JSON.parse(raw) as T
  } catch {
    /* corrupt data, ignore */
  }
  return fallback
}

/** Serialize a value to JSON and write to localStorage. */
export function setStorageJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

/** Read a plain string from localStorage. */
export function getStorageString(key: string): string | null {
  return localStorage.getItem(key)
}

/** Write a plain string to localStorage, or remove the key if value is null. */
export function setStorageString(key: string, value: string | null): void {
  if (value != null) {
    localStorage.setItem(key, value)
  } else {
    localStorage.removeItem(key)
  }
}

/** Remove a key from localStorage. */
export function removeStorage(key: string): void {
  localStorage.removeItem(key)
}

/** Remove all localStorage keys matching a prefix. */
export function removeStorageByPrefix(prefix: string): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) {
      localStorage.removeItem(key)
    }
  }
}

// ---------------------------------------------------------------------------
// Storage key registry
// ---------------------------------------------------------------------------
// All localStorage keys used by the app, in one place.
// Changing a key name here is the single point of update.
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  // Deck
  // TODO: `deck` は pre-profile 時代 (<= v0.10.2) からの migration 読取専用。
  // 十分時間が経ったら読取ごと削除する。
  deck: 'nd-deck',
  deckProfiles: 'nd-deck-profiles',
  deckActiveProfile: 'nd-deck-active-profile',
  deckWallpaper: 'nd-deck-wallpaper',

  // Theme
  themeCompiled: 'nd-theme-compiled',
  themeManual: 'nd-theme-manual',
  themeInstalledThemes: 'nd-installed-themes',
  themeSelectedDark: 'nd-selected-dark-theme',
  themeSelectedLight: 'nd-selected-light-theme',
  themeCustomCss: 'nd-custom-css',
  themeAccountThemes: 'nd-account-themes',

  // Per-feature
  keybinds: 'nd-keybinds',
  plugins: 'nd-plugins',
  // 過去に seed した built-in plugin installId のリスト。skillsSeededBuiltins と
  // 同じ目的: ユーザーが内蔵プラグインを削除した場合の再生成を防ぐ + 新しく
  // 追加された built-in だけを補填する。
  pluginsSeededBuiltins: 'nd-plugins-seeded-builtins',
  widgets: 'nd-widgets',
  widgetsSidebarOrder: 'nd-widgets-sidebar-order',
  recentEmojis: 'nd-recent-emojis',
  emojisCache: 'emojis_cache',
  performance: 'nd-performance',
  mutedAds: 'nd-muted-ads',
  offlineMode: 'nd-offline-mode',
  realtimeMode: 'nd-realtime-mode',

  // UI shell cache (Linear-style instant display)
  shellCache: 'nd-shell-cache',
  shellCacheVersion: 'nd-shell-cache-version',

  // AI settings
  aiSettings: 'nd-ai-settings',
  skillsActive: 'nd-skills-active',
  // 過去に seed した built-in skill id のリスト。ユーザーが内蔵 skill を
  // 削除した場合の再生成を防ぐ + 新しく追加された built-in だけを補填する
  // ために使う。
  skillsSeededBuiltins: 'nd-skills-seeded-builtins',
  // HEARTBEAT (#411) Cheap Check First の transient state:
  // skill id ごとの { lastResultsHash, lastAiRunAt } を 1 つの map に格納
  heartbeatCheapCheckState: 'nd-heartbeat-cheap-check-state',
  // 1 日の AI 起動カウンター (再起動跨ぎでカウント維持):
  // { dateEpochDays, count }
  heartbeatDailyCounter: 'nd-heartbeat-daily-counter',

  // Custom timelines (per-host / per-account)
  customTimeline: (host: string) => `nd:custom_tl:${host}`,
  policies: (accountId: string) => `nd:policies:${accountId}`,

  // Per-account (dynamic key builders)
  notificationCache: (accountId: string) =>
    `nd-cache-notifications-${accountId}`,

  // Per-account registry snapshot (i/registry/* values cached for instant restore on next launch)
  accountRegistry: 'nd-account-registry',

  // AiScript plugin storage prefix
  aiscriptPlugin: (installId: string) => `nd-aiscript-plugin:${installId}:`,
  aiscriptStorage: (storagePrefix: string) => `nd-aiscript-${storagePrefix}:`,
} as const

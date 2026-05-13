import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { emitNoteDeckEvent } from '@/aiscript/events'
import { useSettingsStore } from '@/stores/settings'
import * as themeFileSync from '@/stores/themeFileSync'
import { applyTheme } from '@/theme/applier'
import {
  DARK_BASE,
  DARK_THEME,
  LIGHT_BASE,
  LIGHT_THEME,
} from '@/theme/builtinThemes'
import { compileMisskeyTheme } from '@/theme/compiler'
import { CustomCssManager } from '@/theme/cssApplier'
import type { CompiledProps, MisskeyTheme, ThemeSource } from '@/theme/types'
import { pushSnapshot } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageJson,
  getStorageString,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
} from '@/utils/storage'
import { commands, unwrap } from '@/utils/tauriInvoke'

// Moved inside defineStore below to isolate per-window instance.
// (Module-level Maps leak data between Tauri multi-window contexts.)

// fetchAccountTheme は Misskey の admin Branding (meta default) のみ取得する。
// 「現在選択中のテーマ」(本家 darkTheme/lightTheme Pref) はデバイス local 設定で
// registry に保存されない仕様 (本家 PreferencesManager は themes 一覧のみ
// クラウド同期する)。NoteDeck は本家設計を尊重し、サーバー側の選択値には
// 介入しない。per-column 適用はすべて NoteDeck 内部 cache (localStorage) で完結。
interface ThemeResponse {
  metaDark?: string
  metaLight?: string
}

/** Parse a JSON string theme from /api/meta defaults */
function parseMetaTheme(
  raw: string,
  id: string,
  base: 'dark' | 'light',
): MisskeyTheme | null {
  try {
    const parsed = JSON.parse(raw)
    return {
      id,
      name: parsed.name || `Server ${base === 'dark' ? 'Dark' : 'Light'}`,
      base,
      props: parsed.props || {},
    }
  } catch {
    return null
  }
}

export const useThemeStore = defineStore('theme', () => {
  const settingsStore = useSettingsStore()

  // Per-store-instance caches (isolated per window)
  const compiledCache = new Map<string, CompiledProps>()
  const fetchingAccounts = new Set<string>()

  const currentSource = ref<ThemeSource | null>(null)

  // settingsStore が single source of truth。FOUC 防止は compiled cache
  // (nd-theme-compiled) が担うので、これらの computed は await 済みの
  // settingsStore から正確な値を返す。
  const manualMode = computed<'dark' | 'light' | null>({
    get: () => settingsStore.get('theme.manual') ?? null,
    set: (v) => settingsStore.set('theme.manual', v),
  })
  const selectedDarkThemeId = computed<string | null>({
    get: () => settingsStore.get('theme.selectedDarkThemeId') ?? null,
    set: (v) => settingsStore.set('theme.selectedDarkThemeId', v),
  })
  const selectedLightThemeId = computed<string | null>({
    get: () => settingsStore.get('theme.selectedLightThemeId') ?? null,
    set: (v) => settingsStore.set('theme.selectedLightThemeId', v),
  })

  // accountThemeCache の各 entry は 4 fields で per-account のサーバーテーマを表現。
  //   dark/light    : registry sync (default:darkTheme / default:lightTheme の
  //                   global scope エントリ)。ユーザーが Web UI
  //                   で選択したテーマ。優先度高、per-column 適用にも使われる
  //   metaDark/Light: meta.defaultDarkTheme / meta.defaultLightTheme
  //                   (要 detail: true)。サーバー管理者が設定したインスタンス
  //                   デフォルト (例: yami.ski の DXM)。sync が無い場合の
  //                   fallback としても使われる
  //   _v            : cache 構造のバージョン。古い entry を強制無効化するため
  //
  // shallowRef + full Map replacement で Vue リアクティビティを保証
  const accountThemeCache = shallowRef(
    new Map<
      string,
      {
        _v?: number
        dark?: MisskeyTheme
        light?: MisskeyTheme
        metaDark?: MisskeyTheme
        metaLight?: MisskeyTheme
      }
    >(),
  )

  // entry 構造のバージョン。これが上がると古い entry は cache hit せず再 fetch
  // される (例: localStorage 復元データの構造が古い、registry sync 廃止前の
  // dark/light フィールドが残っている場合など)。
  const ACCOUNT_THEME_CACHE_VERSION = 3

  // User-installed custom themes.
  // shallowRef: テーマは props (CSS 変数 Record) を多数持つため、deep reactive
  // でラップすると N テーマ × ~50 プロパティ分の Proxy 生成コストが発生する。
  // 本ストアではリスト自体の入れ替えのみ行い、テーマオブジェクト内部の
  // in-place 更新は行わないため shallowRef で十分。
  const installedThemes = shallowRef<MisskeyTheme[]>([])
  // Custom CSS
  const customCss = ref('')
  // Whether file-based storage has been initialized
  const initialized = ref(false)

  function init(): void {
    // Restore compiled CSS from localStorage first (sync, FOUC prevention).
    // This is NOT a source of truth — just a rendering cache to avoid a
    // white flash. The actual theme preference comes from settingsStore
    // (already loaded via await in main.ts).
    const storedCompiled = getStorageJson<CompiledProps | null>(
      STORAGE_KEYS.themeCompiled,
      null,
    )
    if (storedCompiled) {
      applyTheme(storedCompiled)
    }

    // Restore installed themes (still localStorage-based, not in settingsStore)
    installedThemes.value = getStorageJson<MisskeyTheme[]>(
      STORAGE_KEYS.themeInstalledThemes,
      [],
    )

    // Restore custom CSS
    const storedCss = getStorageString(STORAGE_KEYS.themeCustomCss)
    if (storedCss) {
      customCss.value = storedCss
      applyCustomCss(storedCss)
    }

    // Apply theme (reads computed from settingsStore — correct values)
    applyCurrentTheme()

    // Defer account theme cache restoration (not needed for initial render)
    queueMicrotask(() => {
      const entries = getStorageJson<
        [string, { dark?: MisskeyTheme; light?: MisskeyTheme }][]
      >(STORAGE_KEYS.themeAccountThemes, [])
      if (entries.length > 0) {
        try {
          accountThemeCache.value = new Map(entries)
        } catch {
          /* ignore corrupt data */
        }
      }
    })

    // Listen for OS dark/light mode changes (only applies when following OS)
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (manualMode.value == null) applyCurrentTheme()
      })

    // Kick off async file sync in background (Tauri only)
    if (settingsFs.isTauri) {
      initFileStorage().catch((e) =>
        console.warn('[theme] file storage init failed:', e),
      )
    } else {
      initialized.value = true
    }
  }

  function wantsDark(): boolean {
    return manualMode.value != null
      ? manualMode.value === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  function applyCurrentTheme(): void {
    const dark = wantsDark()
    const selectedId = dark
      ? selectedDarkThemeId.value
      : selectedLightThemeId.value
    const custom = selectedId
      ? installedThemes.value.find((t) => t.id === selectedId)
      : null
    if (custom) {
      applySource({
        kind: dark ? 'custom-dark' : 'custom-light',
        theme: custom,
      })
    } else {
      applySource({
        kind: dark ? 'builtin-dark' : 'builtin-light',
        theme: dark ? DARK_THEME : LIGHT_THEME,
      })
    }
  }

  function isCurrentDark(): boolean {
    return currentSource.value?.kind.includes('light') === false
  }

  function toggleTheme(): void {
    // computed setter → settingsStore.set() → settings.json persist
    manualMode.value = isCurrentDark() ? 'light' : 'dark'
    applyCurrentTheme()
  }

  function resetToOsTheme(): void {
    manualMode.value = null
    applyCurrentTheme()
  }

  /** Lock current appearance as manual mode (stop following OS) */
  function pinCurrentMode(): void {
    manualMode.value = isCurrentDark() ? 'dark' : 'light'
  }

  /** Install a Misskey theme from JSON code. Returns true on success. */
  async function installTheme(
    code: string,
    forAccountIds: string[] = [],
  ): Promise<boolean> {
    try {
      const JSON5 = (await import('json5')).default
      const parsed = JSON5.parse(code)
      if (!parsed || typeof parsed !== 'object' || !parsed.props) return false

      const theme: MisskeyTheme = {
        id: parsed.id || `custom-${Date.now()}`,
        name: parsed.name || 'Untitled',
        base: parsed.base === 'light' ? 'light' : 'dark',
        props: parsed.props,
      }
      // NoteDeck 独自メタ ($notedeck) はパススルー (misstore からの storeId 等)
      if (parsed.$notedeck && typeof parsed.$notedeck === 'object') {
        theme.$notedeck = { ...parsed.$notedeck }
      }
      // forAccountIds に指定された account 全てを installedFor に追加。
      // per-account カラム経由なら [accountId]、全アカウントカラム経由なら
      // 全 logged-in account ids。
      if (forAccountIds.length > 0) {
        const existing = theme.$notedeck?.installedFor ?? []
        theme.$notedeck = {
          ...(theme.$notedeck ?? {}),
          installedFor: Array.from(new Set([...existing, ...forAccountIds])),
        }
      }

      // Avoid duplicates
      const existingTheme = installedThemes.value.find((t) => t.id === theme.id)
      if (existingTheme) {
        // 上書きケース: 既存テーマの編集前 snapshot を history に push
        pushSnapshot('theme', existingTheme.id, {
          id: existingTheme.id,
          name: existingTheme.name,
          base: existingTheme.base,
          props: existingTheme.props,
        }).catch((e) => console.warn('[theme] history push failed:', e))
        installedThemes.value = installedThemes.value.map((t) =>
          t.id === theme.id ? theme : t,
        )
      } else {
        installedThemes.value = [...installedThemes.value, theme]
      }
      // Sync: localStorage cache
      setStorageJson(STORAGE_KEYS.themeInstalledThemes, installedThemes.value)
      // Async: write only the changed theme to file
      if (initialized.value) {
        themeFileSync
          .persistSingleTheme(theme)
          .catch((e) => console.warn('[theme] failed to persist theme:', e))
      }
      return true
    } catch {
      return false
    }
  }

  function removeTheme(id: string): void {
    const removed = installedThemes.value.find((t) => t.id === id)
    installedThemes.value = installedThemes.value.filter((t) => t.id !== id)
    // Clear selection if removed (computed setter → settingsStore)
    if (selectedDarkThemeId.value === id) {
      selectedDarkThemeId.value = null
    }
    if (selectedLightThemeId.value === id) {
      selectedLightThemeId.value = null
    }
    // Sync: update localStorage cache only (no need to rewrite remaining theme files)
    setStorageJson(STORAGE_KEYS.themeInstalledThemes, installedThemes.value)
    applyCurrentTheme()
    // Async: delete the removed theme file
    if (initialized.value && removed) {
      themeFileSync
        .deleteThemeFile(removed)
        .catch((e) => console.warn('[theme] failed to delete theme file:', e))
    }
  }

  /**
   * テーマの per-account 紐付け (`$notedeck.installedFor`) から accountId を外す。
   * installedFor が空になれば installedThemes 自体からも削除する。
   * per-account テーマカラムでの「× ボタン」=「このアカウントから外す」用。
   */
  function unlinkAccountFromTheme(themeId: string, accountId: string): void {
    const theme = installedThemes.value.find((t) => t.id === themeId)
    if (!theme || !theme.$notedeck?.installedFor) {
      // 紐付けが無いテーマ (Global ローカル / 古い installedFor 無し) の場合は
      // per-account からの除去はそもそも責務外 → no-op
      return
    }
    const remaining = theme.$notedeck.installedFor.filter(
      (id) => id !== accountId,
    )
    if (remaining.length === 0) {
      removeTheme(themeId)
      return
    }
    const updated: MisskeyTheme = {
      ...theme,
      $notedeck: { ...theme.$notedeck, installedFor: remaining },
    }
    installedThemes.value = installedThemes.value.map((t) =>
      t.id === themeId ? updated : t,
    )
    setStorageJson(STORAGE_KEYS.themeInstalledThemes, installedThemes.value)
    if (initialized.value) {
      themeFileSync
        .persistSingleTheme(updated)
        .catch((e) =>
          console.warn('[theme] failed to persist installedFor update:', e),
        )
    }
  }

  function renameTheme(themeId: string, newName: string): void {
    const theme = installedThemes.value.find((t) => t.id === themeId)
    if (!theme) return

    const oldFilename = settingsFs.themeFilename(theme.name || theme.id)
    theme.name = newName
    const newFilename = settingsFs.themeFilename(newName)

    setStorageJson(STORAGE_KEYS.themeInstalledThemes, installedThemes.value)

    if (initialized.value && oldFilename !== newFilename) {
      // Delete old file and write new one (theme id stays the same, only name changes)
      Promise.all([
        settingsFs.deleteTheme(oldFilename),
        themeFileSync.persistSingleTheme(theme),
      ]).catch((e) => console.warn('[theme] failed to rename theme file:', e))
    }
  }

  function selectTheme(id: string | null, mode: 'dark' | 'light'): void {
    // computed setter → settingsStore.set() → settings.json persist
    if (mode === 'dark') {
      selectedDarkThemeId.value = id
    } else {
      selectedLightThemeId.value = id
    }
    applyCurrentTheme()
    emitNoteDeckEvent('theme:applied', { id, mode })
  }

  /**
   * 指定アカウントのカラム単位 per-account テーマを設定する。
   * accountThemeCache (localStorage persist) を更新するだけで、Misskey サーバー
   * 側の registry には書き込まない。「Web UI で選択中のテーマ」は本家でも
   * デバイス local 扱いで registry に保存されない設計のため、NoteDeck も
   * その責任分離を尊重する (双方向同期はしない)。
   *
   * 反映先は **そのアカウントを accountId に持つカラム / 派生 UI のみ** で、
   * デッキ全体 (アカウント非依存領域) のテーマは触らない。
   */
  function applyAccountTheme(
    theme: MisskeyTheme,
    mode: 'dark' | 'light',
    accountId: string,
  ): void {
    const next = new Map(accountThemeCache.value)
    const entry = { ...(next.get(accountId) ?? {}) }
    const stored: MisskeyTheme = {
      ...theme,
      id: `account-${mode}-${accountId}`,
      base: mode,
    }
    entry[mode] = stored
    next.set(accountId, entry)
    accountThemeCache.value = next
    compiledCache.clear()
    styleVarsCache.clear()
    persistAccountThemes()
  }

  /**
   * 指定アカウントのカラム単位 per-account テーマを解除する。
   * accountThemeCache からエントリを削除する。削除後、そのアカウントのカラムは
   * meta default (admin Branding) もしくは builtin にフォールバックする
   * (getCompiledForAccount の `cached.dark ?? cached.metaDark` 経由)。
   */
  function clearAccountTheme(mode: 'dark' | 'light', accountId: string): void {
    const cached = accountThemeCache.value.get(accountId)
    if (!cached?.[mode]) return
    const next = new Map(accountThemeCache.value)
    const entry = { ...cached }
    delete entry[mode]
    if (entry.dark || entry.light || entry.metaDark || entry.metaLight) {
      next.set(accountId, entry)
    } else {
      next.delete(accountId)
    }
    accountThemeCache.value = next
    compiledCache.clear()
    styleVarsCache.clear()
    persistAccountThemes()
  }

  function setCustomCss(css: string): void {
    // 編集前 snapshot を history sidecar に push (fire-and-forget)。
    // 内容が同じ場合は no-op (= UI 再描画で同値が来た場合の bloat 防止)。
    const prev = customCss.value
    if (prev !== css) {
      pushSnapshot('css', 'custom.css', { body: prev }).catch((e) =>
        console.warn('[theme] custom.css history push failed:', e),
      )
    }
    customCss.value = css
    setStorageString(STORAGE_KEYS.themeCustomCss, css || null)
    applyCustomCss(css)
    if (initialized.value) {
      themeFileSync
        .writeCustomCssFile(css)
        .catch((e) => console.warn('[theme] failed to write custom.css:', e))
    }
  }

  const cssManager = new CustomCssManager()

  function applyCustomCss(css: string): void {
    cssManager.apply(css)
  }

  function applySource(source: ThemeSource): void {
    const wasDark = isCurrentDark()
    const base = source.kind.includes('light') ? LIGHT_BASE : DARK_BASE
    const compiled = compileMisskeyTheme(source.theme, base)
    applyTheme(compiled)

    // Invalidate account theme caches only when dark/light mode changes,
    // since the base theme used for compilation differs between modes.
    // Same-mode switches (e.g. dark A → dark B) keep account caches valid.
    const nowDark = !source.kind.includes('light')
    if (wasDark !== nowDark) {
      compiledCache.clear()
      styleVarsCache.clear()
    }

    currentSource.value = source
    setStorageJson(STORAGE_KEYS.themeCompiled, compiled)
  }

  async function fetchAccountTheme(
    accountId: string,
    force = false,
  ): Promise<void> {
    const cached = accountThemeCache.value.get(accountId)
    if (!force && cached?._v === ACCOUNT_THEME_CACHE_VERSION) {
      if (import.meta.env.DEV) {
        console.debug(
          '[theme] fetchAccountTheme cache hit',
          accountId,
          JSON.stringify(cached, null, 2),
        )
      }
      return
    }
    if (fetchingAccounts.has(accountId)) return
    fetchingAccounts.add(accountId)

    try {
      const data = unwrap(
        await commands.apiFetchAccountTheme(accountId),
      ) as ThemeResponse
      if (import.meta.env.DEV) {
        // props の中身まで展開 (registry sync の theme.props が空かどうか確認用)
        console.debug(
          '[theme] fetchAccountTheme raw data',
          accountId,
          JSON.stringify(data, null, 2),
        )
      }
      const entry: {
        _v: number
        dark?: MisskeyTheme
        light?: MisskeyTheme
        metaDark?: MisskeyTheme
        metaLight?: MisskeyTheme
      } = { _v: ACCOUNT_THEME_CACHE_VERSION }

      // metaDark/metaLight: meta.defaultDarkTheme / meta.defaultLightTheme
      // (インスタンス管理者設定のブランディングテーマ。例: yami.ski の DXM)。
      if (data.metaDark) {
        entry.metaDark =
          parseMetaTheme(
            data.metaDark,
            `server-meta-dark-${accountId}`,
            'dark',
          ) ?? undefined
      }
      if (data.metaLight) {
        entry.metaLight =
          parseMetaTheme(
            data.metaLight,
            `server-meta-light-${accountId}`,
            'light',
          ) ?? undefined
      }

      // entry.dark/light は applyAccountTheme (NoteDeck 内 per-column 適用)
      // 経由でしか埋まらない。meta fallback は getCompiledForAccount 側で
      // `cached.dark ?? cached.metaDark` として行う。

      const next = new Map(accountThemeCache.value)
      next.set(accountId, entry)
      accountThemeCache.value = next

      // Invalidate compiled caches so new theme data takes effect
      compiledCache.clear()
      styleVarsCache.clear()

      // Persist to localStorage for instant restore on next launch
      persistAccountThemes()
    } catch (e) {
      if (import.meta.env.DEV) {
        console.debug('[theme] Failed to fetch account theme:', accountId, e)
      }
    } finally {
      fetchingAccounts.delete(accountId)
    }
  }

  // QuotaExceededError が一度出たら以降の persist は skip。
  // 毎回試行→失敗→ログ汚染を避けるため。in-memory cache は維持される。
  let accountThemesPersistDisabled = false

  function persistAccountThemes(): void {
    if (accountThemesPersistDisabled) return
    const entries = Array.from(accountThemeCache.value.entries())
    try {
      setStorageJson(STORAGE_KEYS.themeAccountThemes, entries)
    } catch (e) {
      accountThemesPersistDisabled = true
      if (import.meta.env.DEV) {
        console.warn('[theme] persistAccountThemes disabled (likely quota):', e)
      }
    }
  }

  /** Load themes from files and custom CSS. Files are source of truth. */
  async function initFileStorage(): Promise<void> {
    const data = await themeFileSync.loadFromFiles()

    if (data.themes.length > 0) {
      installedThemes.value = data.themes
      setStorageJson(STORAGE_KEYS.themeInstalledThemes, data.themes)
      applyCurrentTheme()
    }

    if (data.customCss) {
      customCss.value = data.customCss
      setStorageString(STORAGE_KEYS.themeCustomCss, data.customCss)
      applyCustomCss(data.customCss)
    }

    initialized.value = true

    // Migrate: if localStorage has themes but no files exist, write them
    if (data.needsMigrateThemes && installedThemes.value.length > 0) {
      themeFileSync
        .persistAllThemes(installedThemes.value)
        .catch((e) => console.warn('[theme] migration to files failed:', e))
    }
    // Migrate custom CSS to file if not yet written
    if (data.needsMigrateCss && customCss.value) {
      themeFileSync
        .writeCustomCssFile(customCss.value)
        .catch((e) => console.warn('[theme] CSS migration failed:', e))
    }
  }

  function getAccountThemes(accountId: string) {
    return accountThemeCache.value.get(accountId) ?? null
  }

  const styleVarsCache = new Map<string, Record<string, string>>()

  function accountCacheKey(accountId: string): string {
    return `${accountId}:${isCurrentDark() ? 'dark' : 'light'}`
  }

  function getStyleVarsForAccount(
    accountId: string,
  ): Record<string, string> | undefined {
    // Vue computed (useColumnTheme.columnThemeVars 等) から呼ばれた際に
    // accountThemeCache.value への reactive 依存を必ず確立する。styleVarsCache
    // (Map) は reactive 外なので、これが無いと cache hit 時に依存追跡されず、
    // applyAccountTheme で cache を clear してもカラムが再描画されない。
    void accountThemeCache.value
    const cacheKey = accountCacheKey(accountId)

    const cached = styleVarsCache.get(cacheKey)
    if (cached) return cached

    const compiled = getCompiledForAccount(accountId)
    if (!compiled) return undefined
    const style: Record<string, string> = {}
    for (const [key, value] of Object.entries(compiled)) {
      style[`--nd-${key}`] = value
    }
    styleVarsCache.set(cacheKey, style)
    return style
  }

  function getCompiledForAccount(accountId: string): CompiledProps | null {
    void accountThemeCache.value // reactive 依存確立 (上記同様)
    const cacheKey = accountCacheKey(accountId)

    if (compiledCache.has(cacheKey)) return compiledCache.get(cacheKey) ?? null

    const cached = accountThemeCache.value.get(accountId)
    if (!cached) return null

    const dark = isCurrentDark()
    // mode strict: dark モード時は dark のみ、light モード時は light のみ。
    // sync が無ければ meta default を fallback とする (registry sync 削除後も
    // インスタンスデフォルトが残っていれば反映される)。クロスモードの fallback
    // はしない (dark モードで light が当たる混乱を避ける)。
    const theme = dark
      ? (cached.dark ?? cached.metaDark)
      : (cached.light ?? cached.metaLight)
    if (!theme) return null

    const base = dark ? DARK_BASE : LIGHT_BASE
    const compiled = compileMisskeyTheme(theme, base)
    compiledCache.set(cacheKey, compiled)
    return compiled
  }

  return {
    currentSource,
    manualMode,
    accountThemeCache,
    installedThemes,
    selectedDarkThemeId,
    selectedLightThemeId,
    customCss,
    init,
    applySource,
    toggleTheme,
    resetToOsTheme,
    pinCurrentMode,
    installTheme,
    removeTheme,
    unlinkAccountFromTheme,
    renameTheme,
    selectTheme,
    applyAccountTheme,
    clearAccountTheme,
    applyCurrentTheme,
    isCurrentDark,
    setCustomCss,
    fetchAccountTheme,
    getAccountThemes,
    getCompiledForAccount,
    getStyleVarsForAccount,
  }
})

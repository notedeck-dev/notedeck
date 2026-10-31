import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { emitNoteDeckEvent } from '@/aiscript/events'
import { i18n } from '@/i18n'
import {
  isValidThemeId,
  misskeyThemeOf,
  sameThemeContent,
  type ThemeContent,
  type ThemeItem,
  themeCodec,
} from '@/services/distributableCodecs/themeCodec'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { createDistributableStore } from '@/stores/distributableStore'
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
import { type EditAttribution, pushSnapshot } from '@/utils/historyFs'
import { readSafeMode } from '@/utils/safeMode'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageJson,
  getStorageString,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
} from '@/utils/storage'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { notifyWarningToast } from '@/utils/toastNotify'
import { withViewTransition } from '@/utils/viewTransition'
import { isRepresentativeNow } from '@/windows/roles'

export type { ThemeItem } from '@/services/distributableCodecs/themeCodec'
export { misskeyThemeOf } from '@/services/distributableCodecs/themeCodec'

const HISTORY_SUFFIX = '.history.json5'

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

  // Custom CSS
  const customCss = ref('')
  // 初回読込 (ファイル) が済んだか。読込前は選択中のテーマを組込で潰さない
  const initialized = ref(false)

  /**
   * インストール済みテーマのプール (#1202 段階 1)。個体は envelope
   * (`ThemeItem`)、本文は `{ base, props }`。スコープは紐付け配列だけで全体の
   * 印は無く (紐付け 0 はどの管理カラムにも出ないゾンビなので) 外して空に
   * なった本体は消す (`unlinkOrRemove`)。選択・適用はこの store の持ち物で、
   * 削除 / 別の書き手の変更には hook で追随する。読込は `init` が起動時に
   * 始める (eager。選択中のテーマを当てるのに一覧が要る)
   */
  function isSelected(id: string): boolean {
    return selectedDarkThemeId.value === id || selectedLightThemeId.value === id
  }
  interface SelectionSnapshot {
    wasDark: boolean
    wasLight: boolean
  }
  const base = createDistributableStore<ThemeContent, ThemeItem>({
    logTag: 'theme',
    codec: themeCodec,
    files: themeFileSync.themeFiles,
    settingsScope: 'themes',
    fileBaseOf: (name) =>
      name.endsWith(settingsFs.THEME_EXT) && !name.endsWith(HISTORY_SUFFIX)
        ? name.slice(0, -settingsFs.THEME_EXT.length)
        : undefined,
    browserStorageKey: STORAGE_KEYS.themeInstalledThemes,
    generateId: () => `custom-${Date.now()}`,
    // 履歴の形は `theme.revert` (notecore) とエディタの履歴窓が読むので
    // キー名は on-disk の互換を保つ
    history: {
      kind: 'theme',
      snapshot: (t) => ({
        id: t.id,
        name: t.name,
        base: t.content.base,
        props: t.content.props,
      }),
    },
    contentEquals: sameThemeContent,
    purgeAccount: 'unlinkOrRemove',
    hooks: {
      onLoadFailed: () => notifyWarningToast(i18n.ts._theme.loadFailed),
      // 選択中のテーマの中身が変わったら (ストア更新 / 別の書き手) 当て直す
      afterContentChange: (t) => {
        if (isSelected(t.id)) applyCurrentTheme()
      },
      // 削除で選択を外し、undo で戻す
      snapshotForUndo: (t): SelectionSnapshot => ({
        wasDark: selectedDarkThemeId.value === t.id,
        wasLight: selectedLightThemeId.value === t.id,
      }),
      afterRemove: (t) => {
        if (selectedDarkThemeId.value === t.id) selectedDarkThemeId.value = null
        if (selectedLightThemeId.value === t.id) {
          selectedLightThemeId.value = null
        }
        applyCurrentTheme()
      },
      restoreFromUndo: (t, snapshot) => {
        const snap = snapshot as SelectionSnapshot
        if (snap.wasDark) selectedDarkThemeId.value = t.id
        if (snap.wasLight) selectedLightThemeId.value = t.id
        applyCurrentTheme()
      },
    },
  })

  function init(): void {
    // Restore compiled CSS from localStorage first (sync, FOUC prevention).
    // This is NOT a source of truth — just a rendering cache to avoid a
    // white flash. The actual theme preference comes from settingsStore
    // (already loaded via await in main.ts).
    // セーフモード (#794) では FOUC 防止のキャッシュ復元もしない
    // (index.html の boot script も同じ理由で復元をスキップしている)
    const storedCompiled = readSafeMode()
      ? null
      : getStorageJson<CompiledProps | null>(STORAGE_KEYS.themeCompiled, null)
    if (storedCompiled) {
      applyTheme(storedCompiled)
    }

    // 一覧の読込を始める (ブラウザ dev モードは localStorage から同期で、Tauri は
    // ファイルから。Tauri は読み終わるまでテーマ一覧を持たない #1042)
    base.ensureLoaded()

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

    // settingsStore の値が変わったら再適用する。同一ウィンドウ内の変更は
    // 各アクションが applyCurrentTheme を呼ぶが、他ウィンドウ発の
    // nd:settings-changed による settings 再読込はここで拾う。
    watch([manualMode, selectedDarkThemeId, selectedLightThemeId], () =>
      applyCurrentTheme(),
    )

    if (settingsFs.isTauri) {
      void base.whenReady().then(afterFilesLoaded)
      void loadCustomCssFile()
    } else {
      initialized.value = true
      // 旧 UUID の紐付けが残ると テーマがカラムから消えるので、ここでも移行を仕掛ける
      scheduleScopeMigration()
    }
  }

  function wantsDark(): boolean {
    return manualMode.value != null
      ? manualMode.value === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  let themeAppliedOnce = false

  /** 今の明暗で選ばれているテーマ id (セーフモード (#794) では常に null)。 */
  function selectedThemeId(dark: boolean): string | null {
    if (readSafeMode()) return null
    return dark ? selectedDarkThemeId.value : selectedLightThemeId.value
  }

  function applyCurrentTheme(): void {
    const selectedId = selectedThemeId(wantsDark())
    if (
      selectedId &&
      settingsFs.isTauri &&
      !initialized.value &&
      !base.items.value.some((t) => t.id === selectedId)
    ) {
      // ファイル読込前は一覧が空。index.html が当てたコンパイル済みキャッシュを
      // 組込テーマで潰さず、initFileStorage の後の applyCurrentTheme に任せる
      // (#1042)。初回適用もそちらなので themeAppliedOnce はまだ立てない
      return
    }
    const apply = () => {
      const dark = wantsDark()
      const selectedId = selectedThemeId(dark)
      const custom = selectedId
        ? base.items.value.find((t) => t.id === selectedId)
        : null
      if (custom) {
        applySource({
          kind: dark ? 'custom-dark' : 'custom-light',
          theme: misskeyThemeOf(custom),
        })
      } else {
        applySource({
          kind: dark ? 'builtin-dark' : 'builtin-light',
          theme: dark ? DARK_THEME : LIGHT_THEME,
        })
      }
    }
    // 初回 (起動時) は即時適用、以後の切替はクロスフェード
    if (!themeAppliedOnce) {
      themeAppliedOnce = true
      apply()
      return
    }
    withViewTransition(apply)
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

  /**
   * テーマの JSON コード (Misskey 互換の id / name / base / props) を入れる。
   * 同じ id があれば更新 (改名 / 本文。ストア由来の印は保つ)、無ければ追加。
   * `forAccountKeys` はアカウントの安定キー (`accountScopeKey`、#1113) で、
   * 紐付けに足す。false = テーマとして読めない
   */
  async function installTheme(
    code: string,
    forAccountKeys: string[] = [],
    attribution?: EditAttribution,
  ): Promise<boolean> {
    let parsed: ReturnType<typeof themeCodec.decode>
    try {
      parsed = themeCodec.decode(code)
    } catch {
      return false
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.props) return false
    const content: ThemeContent = {
      base: parsed.base === 'light' ? 'light' : 'dark',
      props: parsed.props,
    }
    const id = isValidThemeId(parsed.id) ? parsed.id : undefined
    const existing = id ? base.get(id) : undefined
    let targetId: string
    if (existing) {
      await base.update(
        existing.id,
        { name: parsed.name || existing.name, content },
        attribution,
      )
      targetId = existing.id
    } else {
      const nd = parsed.$notedeck
      const added = await base.add({
        id,
        name: parsed.name || 'Untitled',
        store: nd?.storeId
          ? {
              id: nd.storeId,
              ...(nd.storeSha512 ? { sha512: nd.storeSha512 } : {}),
              ...(nd.storeVersion ? { version: nd.storeVersion } : {}),
            }
          : undefined,
        scope: {
          kind: 'shared',
          global: false,
          installedFor: [...(nd?.installedFor ?? [])],
        },
        content,
        extra: {},
      })
      targetId = added.id
    }
    for (const key of forAccountKeys) {
      await base.link(targetId, { kind: 'account', key })
    }
    return true
  }

  /**
   * テーマの紐付けからアカウントの安定キーを外す。紐付けが空になれば本体ごと
   * 消す (テーマには「全体」の印が無く、紐付け 0 はどの管理カラムにも出ない)。
   * per-account テーマカラムの「× ボタン」=「このアカウントから外す」用。
   *
   * 本体ごと消えた場合のみ、削除を取り消す undo を返す (#988)。紐付けが残る
   * ケースは可逆な「外す」なので undo は返さない (widget の detach と同じ)
   */
  async function unlinkAccountFromTheme(
    themeId: string,
    accountKey: string,
  ): Promise<(() => void) | undefined> {
    const theme = base.get(themeId)
    if (
      theme?.scope.kind !== 'shared' ||
      !theme.scope.installedFor.includes(accountKey)
    ) {
      return undefined
    }
    if (theme.scope.installedFor.length === 1) return base.remove(themeId)
    await base.unlink(themeId, { kind: 'account', key: accountKey })
    return undefined
  }

  /**
   * 既存のテーマをアカウントに紐付ける (ライブラリから追加)。プラグイン・
   * クエリ・ウィジェットのライブラリピッカーと同型で、本体は 1 つのまま
   * 紐付けに安定キーを足す (union)。false = 未知の id
   */
  function linkAccountToTheme(
    themeId: string,
    accountKey: string,
  ): Promise<boolean> {
    return base.link(themeId, { kind: 'account', key: accountKey })
  }

  /**
   * アカウント削除時に、そのアカウントの紐付けをすべて外す (#1114)。
   * 紐付けが無くなるテーマは手動の「外す」と同じく本体ごと消す (宣言
   * `unlinkOrRemove`)。
   *
   * `accountId` (内部 ID) を渡すと per-account の適用キャッシュも捨てる。
   * 紐付け (安定キー) と適用キャッシュ (内部 ID) はキー体系が違うので両方要る
   */
  async function purgeAccount(
    accountKey: string,
    accountId?: string,
  ): Promise<void> {
    await base.purgeAccount(accountKey)
    if (!accountId) return
    if (!accountThemeCache.value.has(accountId)) return
    const next = new Map(accountThemeCache.value)
    next.delete(accountId)
    accountThemeCache.value = next
    compiledCache.clear()
    styleVarsCache.clear()
    persistAccountThemes()
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

  // --- installedFor の安定キー化 (#1113、プラグインの #771 と同型) ---
  const isScopeKey = (v: string) => v.includes(':')
  let scopesMigrated = false

  /**
   * 旧 UUID 紐付けの一括移行。アカウント一覧が要るので accounts ロード後に
   * 1 回だけ走る。
   * - 旧 UUID → 現行アカウントに該当すれば安定キーへ置換、該当しなければ破棄
   * - 置換の結果 空 (紐付け先が全滅) → 現行の全アカウントに紐付け直す。
   *   テーマには「全体」の印が無く、紐付け 0 のテーマはどの管理カラムにも
   *   出ないゾンビになるため
   * 安定キーのみ / 紐付け無しの個体には触れない (冪等)
   */
  async function migrateScopes(): Promise<void> {
    const accountsStore = useAccountsStore()
    if (!accountsStore.isLoaded || scopesMigrated) return
    scopesMigrated = true
    await base.whenReady()
    const uuidToKey = new Map(
      accountsStore.accounts.map((a) => [a.id, accountScopeKey(a)]),
    )
    const allKeys = [...uuidToKey.values()]
    for (const theme of [...base.items.value]) {
      if (theme.scope.kind !== 'shared') continue
      const list = theme.scope.installedFor
      if (list.length === 0 || list.every(isScopeKey)) continue
      const mapped = [
        ...new Set(list.map((v) => (isScopeKey(v) ? v : uuidToKey.get(v)))),
      ].filter((v): v is string => !!v)
      const next = mapped.length > 0 ? mapped : allKeys
      // 先に足してから外す (空の瞬間を作らない — 空になると消える宣言)
      for (const k of next) {
        await base.link(theme.id, { kind: 'account', key: k })
      }
      for (const v of list) {
        if (!isScopeKey(v))
          await base.unlink(theme.id, { kind: 'account', key: v })
      }
    }
  }

  /** accounts のロード完了を待って migrateScopes を 1 回だけ実行する。 */
  function scheduleScopeMigration(): void {
    const accountsStore = useAccountsStore()
    if (accountsStore.isLoaded) {
      void migrateScopes()
      return
    }
    const stop = watch(
      () => accountsStore.isLoaded,
      (ready) => {
        if (!ready) return
        stop()
        void migrateScopes()
      },
    )
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

  function setCustomCss(css: string, attribution?: EditAttribution): void {
    // 編集前 snapshot を history sidecar に push (fire-and-forget)。
    // 内容が同じ場合は no-op (= UI 再描画で同値が来た場合の bloat 防止)。
    const prev = customCss.value
    if (prev !== css) {
      pushSnapshot('css', 'custom.css', { body: prev }, attribution).catch(
        (e) => console.warn('[theme] custom.css history push failed:', e),
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

  // 別の書き手 (notecore の styles.*、他のウィンドウ, #1133 / #1042) が
  // custom.css を書いた → 写しを揃えて画面に反映する (テーマファイルの変更通知は
  // 共通層が受け、hook で選択中のテーマを当て直す)
  registerSettingsFileHandler('root', async (change) => {
    if (change.name !== 'custom.css') return
    let css: string
    try {
      css = change.op === 'delete' ? '' : await settingsFs.readCustomCss()
    } catch (e) {
      console.warn('[theme] reload custom.css failed:', e)
      return
    }
    if (css === customCss.value) return
    customCss.value = css
    setStorageString(STORAGE_KEYS.themeCustomCss, css || null)
    applyCustomCss(css)
  })

  function applyCustomCss(css: string): void {
    // セーフモード (#794) — 起動時復元だけでなく CSS エディタからの保存も
    // 塞ぐ。「編集はできるが効かない」を一箇所で保証する
    if (readSafeMode()) return
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
    if (!force && cached?._v === ACCOUNT_THEME_CACHE_VERSION) return
    if (fetchingAccounts.has(accountId)) return
    fetchingAccounts.add(accountId)

    try {
      const data = unwrap(
        await commands.apiFetchAccountTheme(accountId),
      ) as ThemeResponse
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

  /**
   * ファイルの読込が済んだ後 (Tauri)。選択中のテーマを当て、移行を仕掛け、
   * メインウィンドウだけ themes/ の素の .json5 (コミュニティテーマ) を一回きり
   * コピーして採用する (#1041。採用記録があるので冪等)
   */
  async function afterFilesLoaded(): Promise<void> {
    initialized.value = true
    // ファイルが揃ったので選択中のテーマを当てる (読込前は組込で潰さず待っていた)
    applyCurrentTheme()
    scheduleScopeMigration()
    // drop-in の取り込みは代表窓だけが行う (#1131)
    if (!(await isRepresentativeNow())) return
    const adopted = await themeFileSync
      .adoptDropIns(base.items.value)
      .catch((e) => {
        console.warn('[theme] drop-in adoption failed:', e)
        return [] as ThemeItem[]
      })
    if (adopted.length === 0) return
    base.items.value = [...base.items.value, ...adopted]
    import('@/stores/toast')
      .then(({ useToast }) => {
        const names = adopted
          .map((t) => i18n.tsx._theme.quotedName({ name: t.name }))
          .join(' ')
        useToast().show(i18n.tsx._theme.adoptedDropIns({ names }))
      })
      .catch(() => {
        /* toast unavailable — skip */
      })
  }

  /**
   * custom.css をファイルから読む (Tauri)。ファイルが無く端末ローカルにだけ
   * あれば (旧形式) ファイルへ移す
   */
  async function loadCustomCssFile(): Promise<void> {
    let css: string
    try {
      css = await settingsFs.readCustomCss()
    } catch (e) {
      console.warn('[theme] failed to read custom.css:', e)
      return
    }
    if (css) {
      customCss.value = css
      setStorageString(STORAGE_KEYS.themeCustomCss, css)
      applyCustomCss(css)
    } else if (customCss.value) {
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
    // セーフモード (#794) — per-account のカラムテーマも当てない。
    // getStyleVarsForAccount もここを通るので gate は 1 箇所でよい
    if (readSafeMode()) return null
    void accountThemeCache.value // reactive 依存確立 (上記同様)
    const cacheKey = accountCacheKey(accountId)

    if (compiledCache.has(cacheKey)) return compiledCache.get(cacheKey) ?? null

    const cached = accountThemeCache.value.get(accountId)

    const dark = isCurrentDark()
    // mode strict: dark モード時は dark のみ、light モード時は light のみ。
    // sync が無ければ meta default を fallback とする (registry sync 削除後も
    // インスタンスデフォルトが残っていれば反映される)。クロスモードの fallback
    // はしない (dark モードで light が当たる混乱を避ける)。
    const accountTheme = dark
      ? (cached?.dark ?? cached?.metaDark)
      : (cached?.light ?? cached?.metaLight)

    // per-account テーマが無ければ組込テーマへ落とす (#1046)。グローバルの
    // カスタムテーマはアカウントに紐づかないカラム (アカウントなし / 全
    // アカウント) のものなので、アカウントのカラムに継承させない。
    const theme = accountTheme ?? (dark ? DARK_THEME : LIGHT_THEME)

    const base = dark ? DARK_BASE : LIGHT_BASE
    const compiled = compileMisskeyTheme(theme, base)
    compiledCache.set(cacheKey, compiled)
    return compiled
  }

  return {
    ...base,
    currentSource,
    manualMode,
    accountThemeCache,
    selectedDarkThemeId,
    selectedLightThemeId,
    customCss,
    init,
    applySource,
    toggleTheme,
    resetToOsTheme,
    pinCurrentMode,
    installTheme,
    /** 削除。undo を返す (#988)。選択中なら外し、undo で戻す */
    removeTheme: base.remove,
    unlinkAccountFromTheme,
    linkAccountToTheme,
    purgeAccount,
    migrateScopes,
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

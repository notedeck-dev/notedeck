import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import {
  launchPlugin,
  type ParsedPluginMeta,
  parsePluginMeta,
} from '@/aiscript/plugin-api'
import { casefold, resolveAvailable } from '@/services/settingsSlug'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import { useConfirm } from '@/stores/confirm'
import {
  type PluginMeta,
  type PluginScope,
  usePluginsStore,
} from '@/stores/plugins'
import { type SkillMeta, useSkillsStore } from '@/stores/skills'
import { useThemeStore } from '@/stores/theme'
import { useWidgetsStore, type WidgetMeta } from '@/stores/widgets'
import type { MisskeyTheme } from '@/theme/types'
import { type Frontmatter, parseSkillFile } from '@/utils/skillFrontmatter'

const STORE_BASE_URL = 'https://store.notedeck.io'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function getPluginDetailUrl(id: string): string {
  return `${STORE_BASE_URL}/plugins/${encodeURIComponent(id)}`
}

export function getWidgetDetailUrl(id: string): string {
  return `${STORE_BASE_URL}/widgets/${encodeURIComponent(id)}`
}

export function getThemeDetailUrl(id: string): string {
  return `${STORE_BASE_URL}/themes/${encodeURIComponent(id)}`
}

export function getSkillDetailUrl(id: string): string {
  return `${STORE_BASE_URL}/skills/${encodeURIComponent(id)}`
}

export function getQueryDetailUrl(id: string): string {
  return `${STORE_BASE_URL}/queries/${encodeURIComponent(id)}`
}

// --- MisStore types (mirrors misstore registry schema) ---

export type PluginCategory =
  | 'posting'
  | 'timeline'
  | 'moderation'
  | 'utility'
  | 'integration'
  | 'appearance'
  | 'other'

export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = {
  posting: 'Posting',
  timeline: 'Timeline',
  moderation: 'Moderation',
  utility: 'Utility',
  integration: 'Integration',
  appearance: 'Appearance',
  other: 'Other',
}

export interface StorePluginEntry {
  id: string
  name: string
  version: string
  author: string
  description: string
  category: PluginCategory
  /** Plugin が要求する能力。widget と同じ語彙 (checkKnownCapabilities 参照)。 */
  capabilities?: string[]
  tags: string[]
  sourceUrl: string
  apiUrl: string
  sha512: string
  createdAt: string
  updatedAt: string
  /** 個別アイコン URL (任意。未指定ならフォールバックアイコンを使用) */
  iconUrl?: string
}

export interface StoreThemeEntry {
  id: string
  name: string
  version: string
  author: string
  description: string
  base: 'dark' | 'light'
  tags: string[]
  sourceUrl: string
  apiUrl: string
  sha512: string
  createdAt: string
  updatedAt: string
  /** Full Misskey theme props (CSS variable map). build-registry.js で生成。
   *  プレビューはこれを compileMisskeyTheme に通してフルテーマ色を導出する。 */
  themeProps: Record<string, string>
}

export interface StoreWidgetEntry {
  id: string
  name: string
  version: string
  author: string
  description: string
  icon: string
  autoRun: boolean
  /** Widget が要求する能力。例: 'misskey-api', 'misskey-account'。
   *  NoteDeck 側の互換性判定に使われる (checkWidgetCapabilities 参照)。 */
  capabilities: string[]
  tags: string[]
  sourceUrl: string
  apiUrl: string
  sha512: string
  createdAt: string
  updatedAt: string
  /** 個別アイコン URL (任意。未指定なら icon (Tabler 名) や fallback を使用) */
  iconUrl?: string
}

/**
 * Skill カテゴリは MisStore を SoT として自由文字列で受ける。
 * 既知の category は SKILL_CATEGORY_LABELS で日本語ラベル化、未知のものは
 * カテゴリ文字列をそのまま表示する (UI で fallback)。
 */
export type SkillCategory = string

export const SKILL_CATEGORY_LABELS: Record<string, string> = {
  persona: 'Persona',
  translation: 'Translation',
  summarization: 'Summarization',
  posting: 'Posting',
  moderation: 'Moderation',
  utility: 'Utility',
  other: 'Other',
}

export function skillCategoryLabel(category: string): string {
  return SKILL_CATEGORY_LABELS[category] ?? category
}

export type QueryCategory = 'hide' | 'focus' | 'watch' | 'other'

const QUERY_CATEGORY_LABELS: Record<string, string> = {
  hide: 'Hide',
  focus: 'Focus',
  watch: 'Watch',
  other: 'Other',
}

export function queryCategoryLabel(category: string): string {
  return QUERY_CATEGORY_LABELS[category] ?? category
}

/** カラムクエリ (#783)。registry スキーマは misstore 側 QueryEntry と同型 */
export interface StoreQueryEntry {
  id: string
  name: string
  version: string
  author: string
  description: string
  category: QueryCategory
  tags: string[]
  sourceUrl: string
  apiUrl: string
  sha512: string
  createdAt: string
  updatedAt: string
  authorUrl?: string
  license?: string
  iconUrl?: string
}

export interface StoreSkillEntry {
  id: string
  name: string
  version: string
  author: string
  description: string
  category: SkillCategory
  tags: string[]
  sourceUrl: string
  apiUrl: string
  sha512: string
  createdAt: string
  updatedAt: string
  /** registry が事前に読める frontmatter 値 (任意・UI バッジ用) */
  mode?: 'always' | 'manual' | 'trigger'
  scope?: 'global' | 'per-account'
  triggers?: string[]
  builtIn?: boolean
  /** スキル個別アイコン URL (任意。未指定ならフォールバックアイコンを使用) */
  iconUrl?: string
}

// --- SHA-512 verification ---

async function computeSha512(source: string): Promise<string> {
  const normalized = source.replace(/\r\n/g, '\n')
  const encoded = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-512', encoded)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function fetchSourceText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** 更新確認の主表示はレジストリの updatedAt (#1040)。ロケール非依存で整形する */
function formatUpdatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** 更新適用の確認メッセージ。主 = updatedAt、補助 = version (#1040) */
function updateConfirmMessage(
  name: string,
  e: { updatedAt: string; version: string },
): string {
  return `「${name}」をストアの内容で更新します。\nストア更新日: ${formatUpdatedAt(e.updatedAt)} / v${e.version}`
}

/**
 * ストア由来スキルの上書き更新 patch (#913 の境界)。
 * 本体 (body) とストア由来メタのみ — ローカル値 (改名 name / 実行モード mode /
 * スコープ・installedFor・ローカル ID) は含めない。
 */
function buildSkillStorePatch(
  meta: Frontmatter,
  body: string,
  e: StoreSkillEntry,
  hash: string,
): Partial<SkillMeta> {
  return {
    version: (meta.version as string | undefined) || e.version,
    description: (meta.description as string | undefined) || e.description,
    author: (meta.author as string | undefined) || e.author,
    triggers: Array.isArray(meta.triggers) ? (meta.triggers as string[]) : [],
    body,
    iconUrl: (meta.iconUrl as string | undefined) || e.iconUrl,
    cheapCheckCapabilities: Array.isArray(meta.cheapCheckCapabilities)
      ? (meta.cheapCheckCapabilities as string[])
      : [],
    isPersona: meta.isPersona === true,
    storeId: e.id,
    storeSha512: hash,
    storeVersion: e.version,
  }
}

/**
 * ストア配布テーマの適用 JSON を組み立てる (#913 の境界)。既存インストールが
 * あれば配布内 UUID が変わってもローカル ID・ローカル改名を維持し
 * (themeStore.installTheme が同 ID を既存対応表のファイルへ書く)、
 * installedFor は既存と forAccountIds の union。
 */
function buildThemeWithMeta(
  parsed: Record<string, unknown>,
  existing: MisskeyTheme | undefined,
  e: StoreThemeEntry,
  hash: string,
  forAccountIds: string[],
): Record<string, unknown> {
  const installedFor = Array.from(
    new Set([...(existing?.$notedeck?.installedFor ?? []), ...forAccountIds]),
  )
  return {
    ...parsed,
    ...(existing ? { id: existing.id, name: existing.name } : {}),
    $notedeck: {
      ...((parsed.$notedeck as Record<string, unknown> | undefined) ?? {}),
      storeId: e.id,
      storeSha512: hash,
      storeVersion: e.version,
      ...(installedFor.length > 0 ? { installedFor } : {}),
    },
  }
}

// --- Store ---

export const useMisStoreStore = defineStore('misstore', () => {
  const plugins = shallowRef<StorePluginEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const installing = ref<string | null>(null) // installId of currently installing
  let lastFetchedAt = 0

  const themes = shallowRef<StoreThemeEntry[]>([])
  const themesLoading = ref(false)
  const themesError = ref<string | null>(null)
  const installingTheme = ref<string | null>(null)
  let themesLastFetchedAt = 0

  const widgets = shallowRef<StoreWidgetEntry[]>([])
  const widgetsLoading = ref(false)
  const widgetsError = ref<string | null>(null)
  const installingWidget = ref<string | null>(null)
  let widgetsLastFetchedAt = 0

  const skillEntries = shallowRef<StoreSkillEntry[]>([])
  const skillsLoading = ref(false)
  const skillsError = ref<string | null>(null)
  const installingSkill = ref<string | null>(null)
  let skillsLastFetchedAt = 0

  const queryEntries = shallowRef<StoreQueryEntry[]>([])
  const queriesLoading = ref(false)
  const queriesError = ref<string | null>(null)
  const installingQuery = ref<string | null>(null)
  let queriesLastFetchedAt = 0

  const isCacheValid = () => Date.now() - lastFetchedAt < CACHE_TTL_MS
  const isThemesCacheValid = () =>
    Date.now() - themesLastFetchedAt < CACHE_TTL_MS
  const isWidgetsCacheValid = () =>
    Date.now() - widgetsLastFetchedAt < CACHE_TTL_MS
  const isSkillsCacheValid = () =>
    Date.now() - skillsLastFetchedAt < CACHE_TTL_MS
  const isQueriesCacheValid = () =>
    Date.now() - queriesLastFetchedAt < CACHE_TTL_MS

  // --- baseline 無通知記録 (#1040) ---
  // storeSha512 未記録のインストール済みアイテムは、レジストリ照会時に現行
  // entry.sha512 / version を無通知で基準記録し、次の変更から検知を始める
  // (ローカルソースからの逆算は再シリアライズ形式のため不可能。誤って
  // 「全件更新あり」にしない)。

  function recordPluginBaselines(entries: StorePluginEntry[]): void {
    const pluginsStore = usePluginsStore()
    for (const entry of entries) {
      const p = pluginsStore.plugins.find((p) => p.storeId === entry.id)
      if (p && !p.storeSha512) {
        pluginsStore.recordStoreBaseline(p.installId, {
          storeSha512: entry.sha512,
          storeVersion: entry.version,
        })
      }
    }
  }

  function recordThemeBaselines(entries: StoreThemeEntry[]): void {
    const themeStore = useThemeStore()
    for (const entry of entries) {
      const t = themeStore.installedThemes.find(
        (t) => t.$notedeck?.storeId === entry.id,
      )
      if (t && !t.$notedeck?.storeSha512) {
        themeStore.recordStoreBaseline(t.id, {
          storeSha512: entry.sha512,
          storeVersion: entry.version,
        })
      }
    }
  }

  function recordWidgetBaselines(entries: StoreWidgetEntry[]): void {
    const widgetsStore = useWidgetsStore()
    for (const entry of entries) {
      const w = widgetsStore.widgets.find((w) => w.storeId === entry.id)
      if (w && !w.storeSha512) {
        widgetsStore.recordStoreBaseline(w.installId, {
          storeSha512: entry.sha512,
          storeVersion: entry.version,
        })
      }
    }
  }

  function recordSkillBaselines(entries: StoreSkillEntry[]): void {
    const skillsStore = useSkillsStore()
    for (const entry of entries) {
      const s = skillsStore.skills.find((s) => s.storeId === entry.id)
      if (s && !s.storeSha512) {
        skillsStore.recordStoreBaseline(s.id, {
          storeSha512: entry.sha512,
          storeVersion: entry.version,
        })
      }
    }
  }

  function recordQueryBaselines(entries: StoreQueryEntry[]): void {
    const queriesStore = useColumnQueriesStore()
    for (const entry of entries) {
      const q = queriesStore.queries.find((q) => q.storeId === entry.id)
      if (q && !q.storeSha512) {
        void queriesStore.recordStoreBaseline(q.id, {
          storeSha512: entry.sha512,
          storeVersion: entry.version,
        })
      }
    }
  }

  async function fetchPlugins(): Promise<void> {
    if (isCacheValid() && plugins.value.length > 0) return
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`${STORE_BASE_URL}/registry/plugins.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      plugins.value = data.plugins ?? []
      lastFetchedAt = Date.now()
      recordPluginBaselines(plugins.value)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'fetch failed'
    } finally {
      loading.value = false
    }
  }

  async function fetchThemes(): Promise<void> {
    if (isThemesCacheValid() && themes.value.length > 0) return
    themesLoading.value = true
    themesError.value = null
    try {
      const res = await fetch(`${STORE_BASE_URL}/registry/themes.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      themes.value = data.themes ?? []
      themesLastFetchedAt = Date.now()
      recordThemeBaselines(themes.value)
    } catch (e) {
      themesError.value = e instanceof Error ? e.message : 'fetch failed'
    } finally {
      themesLoading.value = false
    }
  }

  async function fetchWidgets(): Promise<void> {
    if (isWidgetsCacheValid() && widgets.value.length > 0) return
    widgetsLoading.value = true
    widgetsError.value = null
    try {
      const res = await fetch(`${STORE_BASE_URL}/registry/widgets.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      widgets.value = data.widgets ?? []
      widgetsLastFetchedAt = Date.now()
      recordWidgetBaselines(widgets.value)
    } catch (e) {
      widgetsError.value = e instanceof Error ? e.message : 'fetch failed'
    } finally {
      widgetsLoading.value = false
    }
  }

  async function fetchSkills(): Promise<void> {
    if (isSkillsCacheValid() && skillEntries.value.length > 0) return
    skillsLoading.value = true
    skillsError.value = null
    try {
      const res = await fetch(`${STORE_BASE_URL}/registry/skills.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      skillEntries.value = data.skills ?? []
      skillsLastFetchedAt = Date.now()
      recordSkillBaselines(skillEntries.value)
    } catch (e) {
      skillsError.value = e instanceof Error ? e.message : 'fetch failed'
    } finally {
      skillsLoading.value = false
    }
  }

  async function fetchWidgetSource(entry: StoreWidgetEntry): Promise<string> {
    const { source } = await fetchVerifiedSource(
      entry,
      refetchWidgetEntry(entry.id),
    )
    return source
  }

  function refresh(): Promise<void> {
    lastFetchedAt = 0
    return fetchPlugins()
  }

  function refreshThemes(): Promise<void> {
    themesLastFetchedAt = 0
    return fetchThemes()
  }

  function refreshWidgets(): Promise<void> {
    widgetsLastFetchedAt = 0
    return fetchWidgets()
  }

  function refreshSkills(): Promise<void> {
    skillsLastFetchedAt = 0
    return fetchSkills()
  }

  // --- 検証付きソース取得 (#1040 リトライ) ---

  /**
   * 配布ソースを取得し sha512 を照合する。不一致のときは改ざん警告の前に
   * レジストリ index をキャッシュ無効化して再取得し、1 回だけリトライする
   * (ストア更新直後の TTL 内は正常な更新が偽の改ざん警告になるため)。
   * 再取得後も不一致なら従来どおり警告を投げる。
   */
  async function fetchVerifiedSource<
    E extends { id: string; sourceUrl: string; sha512: string },
  >(
    entry: E,
    refetchEntry: () => Promise<E | undefined>,
  ): Promise<{ source: string; hash: string; entry: E }> {
    const source = await fetchSourceText(entry.sourceUrl)
    const hash = await computeSha512(source)
    if (hash === entry.sha512) return { source, hash, entry }
    const fresh = await refetchEntry()
    if (fresh) {
      const retried = await fetchSourceText(fresh.sourceUrl)
      const retriedHash = await computeSha512(retried)
      if (retriedHash === fresh.sha512) {
        return { source: retried, hash: retriedHash, entry: fresh }
      }
    }
    throw new Error('ハッシュ不一致: ソースが改ざんされている可能性があります')
  }

  const refetchPluginEntry = (id: string) => async () => {
    await refresh()
    return plugins.value.find((e) => e.id === id)
  }
  const refetchThemeEntry = (id: string) => async () => {
    await refreshThemes()
    return themes.value.find((e) => e.id === id)
  }
  const refetchWidgetEntry = (id: string) => async () => {
    await refreshWidgets()
    return widgets.value.find((e) => e.id === id)
  }
  const refetchSkillEntry = (id: string) => async () => {
    await refreshSkills()
    return skillEntries.value.find((e) => e.id === id)
  }
  const refetchQueryEntry = (id: string) => async () => {
    await refreshQueries()
    return queryEntries.value.find((e) => e.id === id)
  }

  // --- Install skill ---

  /**
   * MisStore からスキル (.md + frontmatter) を取得して skills/ に保存する。
   * 照合キーは storeId のみ (#913 — 表示名・frontmatter の id 宣言は使わない)。
   * 既存の同 storeId は上書き更新 (再インストール = アップデート)。
   * ローカル値 (改名 name / 実行モード mode / スコープ) は更新で維持する。
   * インストール直後に有効化はしない (mode=always のスキルは常時有効)。
   */
  async function installSkill(entry: StoreSkillEntry): Promise<void> {
    installingSkill.value = entry.id
    try {
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchSkillEntry(entry.id))

      const { meta, body } = parseSkillFile(source)
      const skillsStore = useSkillsStore()
      const existing = skillsStore.skills.find((s) => s.storeId === e.id)
      const now = Date.now()

      if (existing) {
        // 上書き更新: 本体とストア由来メタのみ。ローカル ID・name・mode・
        // scope/installedFor・有効/無効 (activeIds) は維持する
        skillsStore.update(
          existing.id,
          buildSkillStorePatch(meta, body, e, hash),
        )
        return
      }

      // 新規: ローカル ID = storeId (配布物内の ID 宣言よりレジストリの
      // ディレクトリ名を正とする)。storeId 不一致の既存 ID に占有されて
      // いたら上書きせず連番 suffix で回避する
      const takenIds = new Set(skillsStore.skills.map((s) => casefold(s.id)))
      const id = resolveAvailable(e.id, (c) => takenIds.has(casefold(c)))
      const newSkill: SkillMeta = {
        id,
        name: (meta.name as string | undefined) || e.name,
        version: (meta.version as string | undefined) || e.version,
        description: (meta.description as string | undefined) || e.description,
        author: (meta.author as string | undefined) || e.author,
        mode:
          meta.mode === 'always' ||
          meta.mode === 'trigger' ||
          meta.mode === 'heartbeat'
            ? meta.mode
            : 'manual',
        triggers: Array.isArray(meta.triggers)
          ? (meta.triggers as string[])
          : [],
        scope: meta.scope === 'per-account' ? 'per-account' : 'global',
        installedFor:
          meta.scope === 'per-account' && Array.isArray(meta.installedFor)
            ? (meta.installedFor as string[])
            : undefined,
        storeId: e.id,
        storeSha512: hash,
        storeVersion: e.version,
        body,
        createdAt: now,
        updatedAt: now,
        builtIn: false,
        iconUrl: (meta.iconUrl as string | undefined) || e.iconUrl,
        cheapCheckCapabilities: Array.isArray(meta.cheapCheckCapabilities)
          ? (meta.cheapCheckCapabilities as string[])
          : [],
        isPersona: meta.isPersona === true,
      }
      skillsStore.add(newSkill)
    } finally {
      installingSkill.value = null
    }
  }

  function isSkillInstalled(entry: StoreSkillEntry): boolean {
    // 照合キーは storeId のみ (#913 — 内部 ID 一致では真にしない)
    const skillsStore = useSkillsStore()
    return skillsStore.skills.some((s) => s.storeId === entry.id)
  }

  // --- Queries (#783 カラムクエリ) ---

  async function fetchQueries(): Promise<void> {
    if (isQueriesCacheValid() && queryEntries.value.length > 0) return
    queriesLoading.value = true
    queriesError.value = null
    try {
      const res = await fetch(`${STORE_BASE_URL}/registry/queries.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      queryEntries.value = data.queries ?? []
      queriesLastFetchedAt = Date.now()
      recordQueryBaselines(queryEntries.value)
    } catch (e) {
      queriesError.value = e instanceof Error ? e.message : 'fetch failed'
    } finally {
      queriesLoading.value = false
    }
  }

  function refreshQueries(): Promise<void> {
    queriesLastFetchedAt = 0
    return fetchQueries()
  }

  /**
   * MisStore からカラムクエリのソースを取得して名前付きクエリプールへ保存する。
   * 配布はソースのみ・ローカルで必ず再コンパイルされる (#783 不変条件 (e))。
   * 導入してもカラムへの自動適用はしない (自動有効化なし、V18)。
   * 既存の同 storeId は上書き更新 (再インストール = アップデート)。
   */
  async function installQuery(entry: StoreQueryEntry): Promise<void> {
    installingQuery.value = entry.id
    try {
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchQueryEntry(entry.id))

      const queriesStore = useColumnQueriesStore()
      queriesStore.ensureLoaded()
      const existing = queriesStore.queries.find((q) => q.storeId === e.id)
      if (existing) {
        // 上書き更新: 本体とストア由来メタのみ。ローカル改名 (name) は維持
        await queriesStore.applyStoreUpdate(existing.id, {
          src: source,
          description: e.description,
          iconUrl: e.iconUrl,
          storeSha512: hash,
          storeVersion: e.version,
        })
      } else {
        await queriesStore.createQuery({
          // 新規インストールのローカル ID = storeId (#913)。衝突時のみ suffix
          id: resolveAvailable(e.id, (c) =>
            queriesStore.queries.some((q) => casefold(q.id) === c),
          ),
          name: e.name,
          description: e.description,
          src: source,
          storeId: e.id,
          iconUrl: e.iconUrl,
          storeSha512: hash,
          storeVersion: e.version,
        })
      }
    } finally {
      installingQuery.value = null
    }
  }

  function isQueryInstalled(entry: StoreQueryEntry): boolean {
    const queriesStore = useColumnQueriesStore()
    queriesStore.ensureLoaded()
    return queriesStore.queries.some((q) => q.storeId === entry.id)
  }

  // --- Install ---

  /**
   * MisStore からプラグインをインストール / 更新する (#771, #913)。
   * 照合キーは storeId のみ (同名の自作があってもインストール可能 —
   * ファイル名は suffix が捌く)。
   * - 同じ storeId の既存プラグインがあれば本体とストア由来メタを上書き更新し、
   *   指定 scope への参照を追加する (active/configData/scope/name は維持)
   * - 無ければ新規追加 (指定 scope で有効化、storeId 紐付け)
   */
  async function installPlugin(
    entry: StorePluginEntry,
    scope: PluginScope,
  ): Promise<void> {
    installing.value = entry.id
    try {
      const pluginsStore = usePluginsStore()
      const existing = pluginsStore.plugins.find((p) => p.storeId === entry.id)

      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchPluginEntry(entry.id))

      const meta = parsePluginMeta(source)
      if (!meta) {
        throw new Error('プラグインメタデータの解析に失敗しました')
      }

      if (existing) {
        // 追加インストール (別スコープ) でもソースが変われば中身は更新になる。
        // 権限が拡大するなら updatePlugin と同じ再同意を通す (#1040 —
        // この経路を無確認にすると再同意の抜け穴になる)。
        // sha 一致 = 中身が同じなら本体・権限には触れない
        if (existing.storeSha512 !== hash) {
          await confirmPluginUpdate(
            existing,
            { source, hash, entry: e },
            meta,
            { alwaysConfirm: false },
          )
        }
        // 再同意を断られても「このスコープへ入れる」操作自体は成立させる
        // (中身は既存のまま)
        pluginsStore.linkScope(existing.installId, scope)
        return
      }

      const configData: Record<string, unknown> = {}
      if (meta.config) {
        for (const [key, def] of Object.entries(meta.config)) {
          configData[key] = def.default
        }
      }

      const newPlugin: PluginMeta = {
        // 新規インストールのローカル ID = storeId (#913。再インストールで
        // 参照が生き残る)。衝突時のみ連番 suffix
        installId: resolveAvailable(e.id, (c) =>
          pluginsStore.plugins.some((p) => casefold(p.installId) === c),
        ),
        name: meta.name,
        version: meta.version,
        author: meta.author,
        description: meta.description,
        permissions: meta.permissions,
        config: meta.config,
        configData,
        src: source,
        active: true,
        storeId: e.id,
        storeSha512: hash,
        storeVersion: e.version,
        ...(e.iconUrl ? { iconUrl: e.iconUrl } : {}),
        ...(scope.kind === 'global'
          ? { global: true }
          : { installedFor: [scope.key] }),
      }

      pluginsStore.addPlugin(newPlugin)
      await launchPlugin(newPlugin)
    } finally {
      installing.value = null
    }
  }

  // --- Install widget ---

  /**
   * MisStore からウィジェットを取得して widgetsStore に追加 / 更新する。
   * 照合キーは storeId のみ (#913)。同 storeId の既存があれば本体とストア由来
   * メタを上書き更新する (ローカル値 name/autoRun は維持)。
   *
   * AI capability (`widgets.install`) はカラム文脈を持たないので、
   * deckStore.addWidget ではなく widgetsStore.addWidget を直接呼んで
   * カラム外の独立 widget として保存する。カラムへの attach は後から
   * ユーザーが UI でやる想定 (= 「とりあえず手元に入れておく」が正)。
   */
  async function installWidget(entry: StoreWidgetEntry): Promise<WidgetMeta> {
    installingWidget.value = entry.id
    try {
      const widgetsStore = useWidgetsStore()
      const existing = widgetsStore.widgets.find((w) => w.storeId === entry.id)

      // fetchVerifiedSource が sha512 照合済み → hash = 検証済みの値。
      // リトライで index が更新されていたら新 entry (e) の値を記録する
      const {
        source: src,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchWidgetEntry(entry.id))
      if (existing) {
        const updated = widgetsStore.applyStoreUpdate(existing.installId, {
          src,
          iconUrl: e.iconUrl,
          storeSha512: hash,
          storeVersion: e.version,
        })
        return updated ?? existing
      }

      const now = Date.now()
      const widget: WidgetMeta = {
        // 新規インストールのローカル ID = storeId (#913)。衝突時のみ suffix
        installId: resolveAvailable(e.id, (c) =>
          widgetsStore.widgets.some((w) => casefold(w.installId) === c),
        ),
        name: e.name,
        src,
        autoRun: e.autoRun,
        storeId: e.id,
        storeSha512: hash,
        storeVersion: e.version,
        createdAt: now,
        updatedAt: now,
        ...(e.iconUrl ? { iconUrl: e.iconUrl } : {}),
      }
      widgetsStore.addWidget(widget)
      return widget
    } finally {
      installingWidget.value = null
    }
  }

  function isWidgetInstalled(entry: StoreWidgetEntry): boolean {
    const widgetsStore = useWidgetsStore()
    return widgetsStore.widgets.some((w) => w.storeId === entry.id)
  }

  // --- Install theme ---

  /**
   * MisStore からテーマをインストールする。
   * forAccountIds に指定された account 全てを installedFor に追加する。
   * - per-account カラムから呼ぶ場合: [accountId]
   * - cross-account (全アカウント) カラムから呼ぶ場合: 全 logged-in account の id 一覧
   * - 設定経由など account コンテキスト無し: 空配列 (どの account にも紐付かない)
   */
  async function installTheme(
    entry: StoreThemeEntry,
    forAccountIds: string[] = [],
  ): Promise<void> {
    installingTheme.value = entry.id
    try {
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchThemeEntry(entry.id))

      const JSON5 = (await import('json5')).default
      const parsed = JSON5.parse(source)
      // 照合キーは storeId のみ (#913)。既存インストールがあれば
      // installedFor を引き継ぎ、新規 ID と union
      const themeStore = useThemeStore()
      const existing = themeStore.installedThemes.find(
        (t) => t.$notedeck?.storeId === e.id,
      )
      const withMeta = buildThemeWithMeta(
        parsed,
        existing,
        e,
        hash,
        forAccountIds,
      )

      const ok = await themeStore.installTheme(JSON.stringify(withMeta))
      if (!ok) {
        throw new Error('テーマのインストールに失敗しました')
      }
    } finally {
      installingTheme.value = null
    }
  }

  // --- Installed check ---
  // 照合キーは storeId のみ (#913)。表示名・ファイル内 ID では照合しない

  function isInstalled(entry: StorePluginEntry): boolean {
    const pluginsStore = usePluginsStore()
    return pluginsStore.plugins.some((p) => p.storeId === entry.id)
  }

  function isThemeInstalled(entry: StoreThemeEntry): boolean {
    const themeStore = useThemeStore()
    return themeStore.installedThemes.some(
      (t) => t.$notedeck?.storeId === entry.id,
    )
  }

  // --- 更新検知 (#1040) ---
  // 判定は「インストール時に記録した storeSha512」と registry 現行 sha512 の
  // 比較のみ。version 文字列は bump が機械強制されていないため使わない。
  // storeSha512 未記録 (baseline 前) は false — 誤検知しない。

  function hasStoreUpdate(
    recorded: string | undefined,
    entrySha: string,
  ): boolean {
    return !!recorded && recorded !== entrySha
  }

  function hasPluginUpdate(entry: StorePluginEntry): boolean {
    const p = usePluginsStore().plugins.find((p) => p.storeId === entry.id)
    return !!p && hasStoreUpdate(p.storeSha512, entry.sha512)
  }

  function hasThemeUpdate(entry: StoreThemeEntry): boolean {
    const t = useThemeStore().installedThemes.find(
      (t) => t.$notedeck?.storeId === entry.id,
    )
    return !!t && hasStoreUpdate(t.$notedeck?.storeSha512, entry.sha512)
  }

  function hasWidgetUpdate(entry: StoreWidgetEntry): boolean {
    const w = useWidgetsStore().widgets.find((w) => w.storeId === entry.id)
    return !!w && hasStoreUpdate(w.storeSha512, entry.sha512)
  }

  function hasSkillUpdate(entry: StoreSkillEntry): boolean {
    const s = useSkillsStore().skills.find((s) => s.storeId === entry.id)
    return !!s && hasStoreUpdate(s.storeSha512, entry.sha512)
  }

  function hasQueryUpdate(entry: StoreQueryEntry): boolean {
    const queriesStore = useColumnQueriesStore()
    const q = queriesStore.queries.find((q) => q.storeId === entry.id)
    return !!q && hasStoreUpdate(q.storeSha512, entry.sha512)
  }

  // --- 更新適用 (#1040) ---
  // 更新ボタン → ソース fetch + sha 照合 (不一致は index 再取得の 1 回リトライ)
  // → 適用前に全文 diff 付き確認 → 承認で「確認に使った内容」をそのまま適用する。
  // 承認後の再 fetch・再計算はしない — 見せたものと書くものの一致が承認 UI の
  // 意味そのもの (#981 不変条件)。未インストール (既存なし) は install* の担当で
  // false を返す。戻り値は「適用したか」(キャンセル / 未インストールで false)。

  async function updateWidget(entry: StoreWidgetEntry): Promise<boolean> {
    const widgetsStore = useWidgetsStore()
    const existing = widgetsStore.widgets.find((w) => w.storeId === entry.id)
    if (!existing) return false
    installingWidget.value = entry.id
    try {
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchWidgetEntry(entry.id))
      const ok = await useConfirm().confirm({
        title: 'ウィジェットを更新',
        message: updateConfirmMessage(existing.name || e.name, e),
        okLabel: '更新',
        diff: { old: existing.src, new: source, language: 'aiscript' },
      })
      if (!ok) return false
      widgetsStore.applyStoreUpdate(existing.installId, {
        src: source,
        iconUrl: e.iconUrl,
        storeSha512: hash,
        storeVersion: e.version,
      })
      return true
    } finally {
      installingWidget.value = null
    }
  }

  /**
   * 取得済みソースを既存プラグインへ適用する (#1040)。
   * installPlugin の既存分岐と updatePlugin の共用点。
   *
   * 再同意: permissions が拡大する更新 (新規権限の出現) は新しい権限を明示して
   * 確認する。既存側の記録が無いなど比較できない場合は拡大側に倒す
   * (before = 空集合)。`alwaysConfirm` = 更新操作 (差分の確認自体が目的) は
   * 権限が変わらなくても確認する。
   *
   * @returns 適用したら true / ユーザーが拒否したら false
   */
  async function confirmPluginUpdate(
    existing: PluginMeta,
    fetched: { source: string; hash: string; entry: StorePluginEntry },
    meta: ParsedPluginMeta,
    opts: { alwaysConfirm: boolean },
  ): Promise<boolean> {
    const { source, hash, entry: e } = fetched
    const before = new Set(existing.permissions ?? [])
    const added = (meta.permissions ?? []).filter((p) => !before.has(p))
    if (opts.alwaysConfirm || added.length > 0) {
      let message = updateConfirmMessage(existing.name || e.name, e)
      if (added.length > 0) {
        message += `\n新しい権限: ${added.join(', ')}`
      }
      const ok = await useConfirm().confirm({
        title: 'プラグインを更新',
        message,
        okLabel: '更新',
        ...(added.length > 0 ? { type: 'warning' as const } : {}),
        diff: { old: existing.src, new: source, language: 'aiscript' },
      })
      if (!ok) return false
    }
    usePluginsStore().applyStoreUpdate(existing.installId, {
      src: source,
      version: meta.version,
      author: meta.author,
      description: meta.description,
      permissions: meta.permissions,
      config: meta.config,
      iconUrl: e.iconUrl,
      storeSha512: hash,
      storeVersion: e.version,
    })
    return true
  }

  async function updatePlugin(entry: StorePluginEntry): Promise<boolean> {
    const pluginsStore = usePluginsStore()
    const existing = pluginsStore.plugins.find((p) => p.storeId === entry.id)
    if (!existing) return false
    installing.value = entry.id
    try {
      const fetched = await fetchVerifiedSource(
        entry,
        refetchPluginEntry(entry.id),
      )
      const meta = parsePluginMeta(fetched.source)
      if (!meta) {
        throw new Error('プラグインメタデータの解析に失敗しました')
      }
      // 更新はスコープに触れない (linkScope しない — 有効範囲はローカル値)
      return await confirmPluginUpdate(existing, fetched, meta, {
        alwaysConfirm: true,
      })
    } finally {
      installing.value = null
    }
  }

  async function updateSkill(entry: StoreSkillEntry): Promise<boolean> {
    const skillsStore = useSkillsStore()
    const existing = skillsStore.skills.find((s) => s.storeId === entry.id)
    if (!existing) return false
    installingSkill.value = entry.id
    try {
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchSkillEntry(entry.id))
      const { meta, body } = parseSkillFile(source)
      const ok = await useConfirm().confirm({
        title: 'スキルを更新',
        message: updateConfirmMessage(existing.name || e.name, e),
        okLabel: '更新',
        // 本体 = frontmatter を除いた body 同士で比較する (ローカルは body
        // しか保持しない。frontmatter 由来メタは patch 側が反映する)
        diff: { old: existing.body, new: body, language: 'markdown' },
      })
      if (!ok) return false
      skillsStore.update(existing.id, buildSkillStorePatch(meta, body, e, hash))
      return true
    } finally {
      installingSkill.value = null
    }
  }

  async function updateQuery(entry: StoreQueryEntry): Promise<boolean> {
    const queriesStore = useColumnQueriesStore()
    queriesStore.ensureLoaded()
    const existing = queriesStore.queries.find((q) => q.storeId === entry.id)
    if (!existing) return false
    installingQuery.value = entry.id
    try {
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchQueryEntry(entry.id))
      const ok = await useConfirm().confirm({
        title: 'クエリを更新',
        message: updateConfirmMessage(existing.name || e.name, e),
        okLabel: '更新',
        diff: { old: existing.src, new: source, language: 'aiscript' },
      })
      if (!ok) return false
      await queriesStore.applyStoreUpdate(existing.id, {
        src: source,
        description: e.description,
        iconUrl: e.iconUrl,
        storeSha512: hash,
        storeVersion: e.version,
      })
      return true
    } finally {
      installingQuery.value = null
    }
  }

  async function updateTheme(
    entry: StoreThemeEntry,
    forAccountIds: string[] = [],
  ): Promise<boolean> {
    const themeStore = useThemeStore()
    const existing = themeStore.installedThemes.find(
      (t) => t.$notedeck?.storeId === entry.id,
    )
    if (!existing) return false
    installingTheme.value = entry.id
    try {
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, refetchThemeEntry(entry.id))
      const JSON5 = (await import('json5')).default
      const parsed = JSON5.parse(source)
      const withMeta = buildThemeWithMeta(
        parsed,
        existing,
        e,
        hash,
        forAccountIds,
      )
      // fileBase は runtime-only (書込前に strip される) なので diff に出さない
      const { fileBase: _fileBase, ...currentTheme } = existing
      const newJson = JSON.stringify(withMeta, null, 2)
      const ok = await useConfirm().confirm({
        title: 'テーマを更新',
        message: updateConfirmMessage(existing.name || e.name, e),
        okLabel: '更新',
        diff: {
          old: JSON.stringify(currentTheme, null, 2),
          new: newJson,
          language: 'json5',
        },
      })
      if (!ok) return false
      // 不変条件: 確認に使った全文をそのまま書き込む (#981)
      const applied = await themeStore.installTheme(newJson)
      if (!applied) {
        throw new Error('テーマのインストールに失敗しました')
      }
      return true
    } finally {
      installingTheme.value = null
    }
  }

  return {
    plugins,
    loading,
    error,
    installing,
    themes,
    themesLoading,
    themesError,
    installingTheme,
    widgets,
    widgetsLoading,
    widgetsError,
    installingWidget,
    skills: skillEntries,
    skillsLoading,
    skillsError,
    installingSkill,
    fetchPlugins,
    fetchThemes,
    fetchWidgets,
    fetchWidgetSource,
    fetchSkills,
    refresh,
    refreshThemes,
    refreshWidgets,
    refreshSkills,
    installPlugin,
    installTheme,
    installWidget,
    installSkill,
    queries: queryEntries,
    queriesLoading,
    queriesError,
    installingQuery,
    fetchQueries,
    refreshQueries,
    installQuery,
    isQueryInstalled,
    isInstalled,
    isThemeInstalled,
    isWidgetInstalled,
    isSkillInstalled,
    hasPluginUpdate,
    hasThemeUpdate,
    hasWidgetUpdate,
    hasSkillUpdate,
    hasQueryUpdate,
    updatePlugin,
    updateTheme,
    updateWidget,
    updateSkill,
    updateQuery,
  }
})

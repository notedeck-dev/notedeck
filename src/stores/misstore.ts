import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { launchPlugin, parsePluginMeta } from '@/aiscript/plugin-api'
import { casefold, resolveAvailable } from '@/services/settingsSlug'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import {
  type PluginMeta,
  type PluginScope,
  usePluginsStore,
} from '@/stores/plugins'
import { type SkillMeta, useSkillsStore } from '@/stores/skills'
import { useThemeStore } from '@/stores/theme'
import { useWidgetsStore, type WidgetMeta } from '@/stores/widgets'
import { parseSkillFile } from '@/utils/skillFrontmatter'

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
    const res = await fetch(entry.sourceUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const source = await res.text()

    const hash = await computeSha512(source)
    if (hash !== entry.sha512) {
      throw new Error(
        'ハッシュ不一致: ソースが改ざんされている可能性があります',
      )
    }
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
      const res = await fetch(entry.sourceUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const source = await res.text()

      const hash = await computeSha512(source)
      if (hash !== entry.sha512) {
        throw new Error(
          'ハッシュ不一致: ソースが改ざんされている可能性があります',
        )
      }

      const { meta, body } = parseSkillFile(source)
      const skillsStore = useSkillsStore()
      const existing = skillsStore.skills.find((s) => s.storeId === entry.id)
      const now = Date.now()

      if (existing) {
        // 上書き更新: 本体とストア由来メタのみ。ローカル ID・name・mode・
        // scope/installedFor・有効/無効 (activeIds) は維持する
        skillsStore.update(existing.id, {
          version: (meta.version as string | undefined) || entry.version,
          description:
            (meta.description as string | undefined) || entry.description,
          author: (meta.author as string | undefined) || entry.author,
          triggers: Array.isArray(meta.triggers)
            ? (meta.triggers as string[])
            : [],
          body,
          iconUrl: (meta.iconUrl as string | undefined) || entry.iconUrl,
          cheapCheckCapabilities: Array.isArray(meta.cheapCheckCapabilities)
            ? (meta.cheapCheckCapabilities as string[])
            : [],
          isPersona: meta.isPersona === true,
          storeId: entry.id,
          storeSha512: hash,
          storeVersion: entry.version,
        })
        return
      }

      // 新規: ローカル ID = storeId (配布物内の ID 宣言よりレジストリの
      // ディレクトリ名を正とする)。storeId 不一致の既存 ID に占有されて
      // いたら上書きせず連番 suffix で回避する
      const takenIds = new Set(skillsStore.skills.map((s) => casefold(s.id)))
      const id = resolveAvailable(entry.id, (c) => takenIds.has(casefold(c)))
      const newSkill: SkillMeta = {
        id,
        name: (meta.name as string | undefined) || entry.name,
        version: (meta.version as string | undefined) || entry.version,
        description:
          (meta.description as string | undefined) || entry.description,
        author: (meta.author as string | undefined) || entry.author,
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
        storeId: entry.id,
        storeSha512: hash,
        storeVersion: entry.version,
        body,
        createdAt: now,
        updatedAt: now,
        builtIn: false,
        iconUrl: (meta.iconUrl as string | undefined) || entry.iconUrl,
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
      const res = await fetch(entry.sourceUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const source = await res.text()

      const hash = await computeSha512(source)
      if (hash !== entry.sha512) {
        throw new Error(
          'ハッシュ不一致: ソースが改ざんされている可能性があります',
        )
      }

      const queriesStore = useColumnQueriesStore()
      queriesStore.ensureLoaded()
      const existing = queriesStore.queries.find((q) => q.storeId === entry.id)
      if (existing) {
        // 上書き更新: 本体とストア由来メタのみ。ローカル改名 (name) は維持
        await queriesStore.applyStoreUpdate(existing.id, {
          src: source,
          description: entry.description,
          iconUrl: entry.iconUrl,
          storeSha512: hash,
          storeVersion: entry.version,
        })
      } else {
        await queriesStore.createQuery({
          // 新規インストールのローカル ID = storeId (#913)。衝突時のみ suffix
          id: resolveAvailable(entry.id, (c) =>
            queriesStore.queries.some((q) => casefold(q.id) === c),
          ),
          name: entry.name,
          description: entry.description,
          src: source,
          storeId: entry.id,
          iconUrl: entry.iconUrl,
          storeSha512: hash,
          storeVersion: entry.version,
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

      const res = await fetch(entry.sourceUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const source = await res.text()

      const hash = await computeSha512(source)
      if (hash !== entry.sha512) {
        throw new Error(
          'ハッシュ不一致: ソースが改ざんされている可能性があります',
        )
      }

      const meta = parsePluginMeta(source)
      if (!meta) {
        throw new Error('プラグインメタデータの解析に失敗しました')
      }

      if (existing) {
        pluginsStore.applyStoreUpdate(existing.installId, {
          src: source,
          version: meta.version,
          author: meta.author,
          description: meta.description,
          permissions: meta.permissions,
          config: meta.config,
          iconUrl: entry.iconUrl,
          storeSha512: hash,
          storeVersion: entry.version,
        })
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
        installId: resolveAvailable(entry.id, (c) =>
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
        storeId: entry.id,
        storeSha512: hash,
        storeVersion: entry.version,
        ...(entry.iconUrl ? { iconUrl: entry.iconUrl } : {}),
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

      // fetchWidgetSource が sha512 照合済み → entry.sha512 = 検証済みの値
      const src = await fetchWidgetSource(entry)
      if (existing) {
        const updated = widgetsStore.applyStoreUpdate(existing.installId, {
          src,
          iconUrl: entry.iconUrl,
          storeSha512: entry.sha512,
          storeVersion: entry.version,
        })
        return updated ?? existing
      }

      const now = Date.now()
      const widget: WidgetMeta = {
        // 新規インストールのローカル ID = storeId (#913)。衝突時のみ suffix
        installId: resolveAvailable(entry.id, (c) =>
          widgetsStore.widgets.some((w) => casefold(w.installId) === c),
        ),
        name: entry.name,
        src,
        autoRun: entry.autoRun,
        storeId: entry.id,
        storeSha512: entry.sha512,
        storeVersion: entry.version,
        createdAt: now,
        updatedAt: now,
        ...(entry.iconUrl ? { iconUrl: entry.iconUrl } : {}),
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
      const res = await fetch(entry.sourceUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const source = await res.text()

      const hash = await computeSha512(source)
      if (hash !== entry.sha512) {
        throw new Error(
          'ハッシュ不一致: ソースが改ざんされている可能性があります',
        )
      }

      const JSON5 = (await import('json5')).default
      const parsed = JSON5.parse(source)
      // 照合キーは storeId のみ (#913)。既存インストールがあれば
      // installedFor を引き継ぎ、新規 ID と union
      const themeStore = useThemeStore()
      const existing = themeStore.installedThemes.find(
        (t) => t.$notedeck?.storeId === entry.id,
      )
      const installedForBase = existing?.$notedeck?.installedFor ?? []
      const installedFor = Array.from(
        new Set([...installedForBase, ...forAccountIds]),
      )
      const withMeta = {
        ...parsed,
        // 更新は配布内 UUID が変わってもローカル ID・ローカル改名を維持する
        // (themeStore.installTheme が同 ID を既存対応表のファイルへ書く)
        ...(existing ? { id: existing.id, name: existing.name } : {}),
        $notedeck: {
          ...(parsed.$notedeck ?? {}),
          storeId: entry.id,
          storeSha512: hash,
          storeVersion: entry.version,
          ...(installedFor.length > 0 ? { installedFor } : {}),
        },
      }

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
  }
})

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { launchPlugin, parsePluginMeta } from '@/aiscript/plugin-api'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { type SkillMeta, useSkillsStore } from '@/stores/skills'
import { useThemeStore } from '@/stores/theme'
import {
  generateWidgetId,
  useWidgetsStore,
  type WidgetMeta,
} from '@/stores/widgets'
import { parseSkillFile } from '@/utils/skillFrontmatter'

const STORE_BASE_URL = 'https://misstore.hital.in'
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

  const isCacheValid = () => Date.now() - lastFetchedAt < CACHE_TTL_MS
  const isThemesCacheValid = () =>
    Date.now() - themesLastFetchedAt < CACHE_TTL_MS
  const isWidgetsCacheValid = () =>
    Date.now() - widgetsLastFetchedAt < CACHE_TTL_MS
  const isSkillsCacheValid = () =>
    Date.now() - skillsLastFetchedAt < CACHE_TTL_MS

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
   * 既存の同 storeId/同 id は上書き更新 (再インストール = アップデート)。
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
      const id = (meta.id as string | undefined) || entry.id
      const existing = skillsStore.get(id)
      const now = Date.now()
      const newSkill: SkillMeta = {
        id,
        name: (meta.name as string | undefined) || entry.name,
        version: (meta.version as string | undefined) || entry.version,
        description:
          (meta.description as string | undefined) || entry.description,
        author: (meta.author as string | undefined) || entry.author,
        mode:
          meta.mode === 'always' || meta.mode === 'trigger'
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
        body,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        builtIn: false,
        iconUrl: (meta.iconUrl as string | undefined) || entry.iconUrl,
        cheapCheckCapabilities: Array.isArray(meta.cheapCheckCapabilities)
          ? (meta.cheapCheckCapabilities as string[])
          : [],
      }

      if (existing) {
        skillsStore.update(id, newSkill)
      } else {
        skillsStore.add(newSkill)
      }
    } finally {
      installingSkill.value = null
    }
  }

  function isSkillInstalled(entry: StoreSkillEntry): boolean {
    const skillsStore = useSkillsStore()
    return skillsStore.skills.some(
      (s) => s.storeId === entry.id || s.id === entry.id,
    )
  }

  // --- Install ---

  /**
   * MisStore からプラグインをインストール / 紐付け追加する。
   * - 同じ storeId の既存プラグインがあれば installedFor に accountIds を union 追加
   *   (重複インストールは避ける)
   * - 無ければ新規追加 (installedFor に forAccountIds をセット、storeId 紐付け)
   */
  async function installPlugin(
    entry: StorePluginEntry,
    forAccountIds: string[] = [],
  ): Promise<void> {
    installing.value = entry.id
    try {
      const pluginsStore = usePluginsStore()
      // 既に同 storeId でインストール済みなら installedFor を追加するだけ
      const existing = pluginsStore.plugins.find((p) => p.storeId === entry.id)
      if (existing) {
        pluginsStore.linkAccountToPlugin(existing.installId, forAccountIds)
        return
      }

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

      if (pluginsStore.isDuplicate(meta.name)) {
        throw new Error(`"${meta.name}" は既にインストールされています`)
      }

      const configData: Record<string, unknown> = {}
      if (meta.config) {
        for (const [key, def] of Object.entries(meta.config)) {
          configData[key] = def.default
        }
      }

      const newPlugin: PluginMeta = {
        installId: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
        ...(entry.iconUrl ? { iconUrl: entry.iconUrl } : {}),
        ...(forAccountIds.length > 0 ? { installedFor: forAccountIds } : {}),
      }

      pluginsStore.addPlugin(newPlugin)
      await launchPlugin(newPlugin)
    } finally {
      installing.value = null
    }
  }

  // --- Install widget ---

  /**
   * MisStore からウィジェットを取得して widgetsStore に追加する。
   * 同 storeId のウィジェットが既にあれば再インストールせず early return
   * (UI 側の DeckWidgetColumn ライブラリインストール挙動と整合)。
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
      if (existing) return existing

      const src = await fetchWidgetSource(entry)
      const now = Date.now()
      const widget: WidgetMeta = {
        installId: generateWidgetId(),
        name: entry.name,
        src,
        autoRun: entry.autoRun,
        storeId: entry.id,
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
      // 既存インストールがあれば installedFor を引き継ぎ、新規 ID と union
      const themeStore = useThemeStore()
      const existing = themeStore.installedThemes.find(
        (t) => t.id === entry.id || t.$notedeck?.storeId === entry.id,
      )
      const installedForBase = existing?.$notedeck?.installedFor ?? []
      const installedFor = Array.from(
        new Set([...installedForBase, ...forAccountIds]),
      )
      const withMeta = {
        ...parsed,
        $notedeck: {
          ...(parsed.$notedeck ?? {}),
          storeId: entry.id,
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

  function isInstalled(entry: StorePluginEntry): boolean {
    const pluginsStore = usePluginsStore()
    return pluginsStore.plugins.some((p) => p.name === entry.name)
  }

  function isThemeInstalled(entry: StoreThemeEntry): boolean {
    // id 比較が一次基準: MisStore は id ユニーク (ame / dark-amethyst 等) なので
    // 同 id があれば確実にこの store entry のインストール済みコピー。
    // storeId 比較を fallback にするのは、テーマインストール時 themeStore は
    // theme.id を尊重するが、parsed の id が衝突した時 themeStore 側で
    // `custom-${Date.now()}` に置換される可能性があるため (theme.ts L236)。
    const themeStore = useThemeStore()
    return themeStore.installedThemes.some(
      (t) => t.id === entry.id || t.$notedeck?.storeId === entry.id,
    )
  }

  const installedNames = computed(() => {
    const pluginsStore = usePluginsStore()
    return new Set(pluginsStore.plugins.map((p) => p.name))
  })

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
    isInstalled,
    isThemeInstalled,
    isWidgetInstalled,
    isSkillInstalled,
    installedNames,
  }
})

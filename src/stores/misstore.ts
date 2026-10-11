import { defineStore } from 'pinia'
import { type Ref, ref, type ShallowRef, shallowRef } from 'vue'
import { type ParsedPluginMeta, parsePluginMeta } from '@/aiscript/plugin-api'
import { i18n } from '@/i18n'
import {
  type DistributableKind,
  type DistributableMeta,
  type DistributableScope,
  type DistributableStoreOrigin,
  hasScopeTarget,
  type ScopeTarget,
  withScopeTarget,
} from '@/services/distributable'
import {
  sameThemeContent,
  type ThemeContent,
  themeCodec,
} from '@/services/distributableCodecs/themeCodec'
import { casefold, resolveAvailable } from '@/services/settingsSlug'
import { type Frontmatter, parseSkillFile } from '@/services/skillFrontmatter'
import { type QueryItem, useColumnQueriesStore } from '@/stores/columnQueries'
import { useConfirm } from '@/stores/confirm'
import type { StoreUpdatePatch } from '@/stores/distributableStore'
import {
  type PluginItem,
  type PluginStorePatch,
  usePluginsStore,
} from '@/stores/plugins'
import {
  type SkillItem,
  type SkillStorePatch,
  useSkillsStore,
} from '@/stores/skills'
import { type ThemeItem, useThemeStore } from '@/stores/theme'
import { useWidgetsStore, type WidgetItem } from '@/stores/widgets'

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
  return i18n.tsx._misstore.updateConfirm({
    name,
    date: formatUpdatedAt(e.updatedAt),
    version: e.version,
  })
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
): SkillStorePatch {
  return {
    content: body,
    description: (meta.description as string | undefined) || e.description,
    iconUrl: (meta.iconUrl as string | undefined) || e.iconUrl,
    version: (meta.version as string | undefined) || e.version,
    author: (meta.author as string | undefined) || e.author,
    triggers: Array.isArray(meta.triggers) ? (meta.triggers as string[]) : [],
    cheapCheckCapabilities: Array.isArray(meta.cheapCheckCapabilities)
      ? (meta.cheapCheckCapabilities as string[])
      : [],
    isPersona: meta.isPersona === true,
    store: { id: e.id, sha512: hash, version: e.version },
  }
}

/**
 * ストア配布テーマのソース (Misskey 互換の JSON5) を本文に読む。`props` の無い
 * ものはテーマではない
 */
function parseThemeSource(source: string): ThemeContent {
  const parsed = themeCodec.decode(source)
  if (!parsed || typeof parsed !== 'object' || !parsed.props) {
    throw new Error(i18n.ts._misstore.themeInstallFailed)
  }
  return {
    base: parsed.base === 'light' ? 'light' : 'dark',
    props: parsed.props,
  }
}

// --- Registry feed ---
// レジストリ index の取得・TTL キャッシュ・baseline 記録・インストール済み
// 判定・更新検知は 5 種の配布物で完全に同型なので 1 つに畳む (#1098)。
// kind ごとに違うのは「どの store の個体か」だけ

/** レジストリの entry に共通の面 (5 種のストアカードと手続きが見る範囲) */
export interface StoreEntryBase {
  id: string
  name: string
  version: string
  sourceUrl: string
  sha512: string
  updatedAt: string
}

/**
 * ストア連携の相手になる kind の store (factory の面の部分集合、#1202 段階 2)。
 * Pinia の store がそのまま満たす
 */
interface KindStore<Item extends DistributableMeta<unknown, unknown>, Patch> {
  items: Item[]
  ensureLoaded(): void
  applyStoreUpdate(id: string, patch: Patch): Promise<boolean>
  link(id: string, target: ScopeTarget): Promise<boolean>
  recordStoreBaseline(
    id: string,
    baseline: { sha512: string; version: string },
  ): Promise<void>
}

/** kind → ストアの entry 型 (公開面は kind で引く、#1202 段階 3) */
export type StoreEntryOf<K extends DistributableKind> = {
  plugin: StorePluginEntry
  widget: StoreWidgetEntry
  query: StoreQueryEntry
  skill: StoreSkillEntry
  theme: StoreThemeEntry
}[K]

/** カラムから見たレジストリの状態 (読取専用の写し + 取得) */
export interface StoreFeedView<E extends StoreEntryBase> {
  readonly entries: E[]
  readonly loading: boolean
  readonly error: string | null
  fetch(): Promise<void>
  refresh(): Promise<void>
}

interface RegistryFeed<E extends StoreEntryBase> {
  entries: ShallowRef<E[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** インストール / 更新中の entry id (UI のスピナー用) */
  installing: Ref<string | null>
  fetch(): Promise<void>
  refresh(): Promise<void>
  refetchEntry(id: string): () => Promise<E | undefined>
  isInstalled(entry: E): boolean
  hasUpdate(entry: E): boolean
}

/**
 * 更新検知 (#1040) の判定は「インストール時に記録した sha512」と registry
 * 現行 sha512 の比較のみ。version 文字列は bump が機械強制されていないため
 * 使わない。sha512 未記録 (baseline 前) は false — 誤検知しない。
 */
function hasStoreUpdate(
  recorded: string | undefined,
  entrySha: string,
): boolean {
  return !!recorded && recorded !== entrySha
}

function createRegistryFeed<E extends StoreEntryBase>(
  registryKey: 'plugins' | 'themes' | 'widgets' | 'skills' | 'queries',
  /** entry に対応するインストール済み個体を持つ store。照合キーは storeId のみ (#913) */
  store: () => KindStore<DistributableMeta<unknown, unknown>, unknown>,
): RegistryFeed<E> {
  const entries = shallowRef<E[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const installing = ref<string | null>(null)
  let lastFetchedAt = 0
  const isCacheValid = () => Date.now() - lastFetchedAt < CACHE_TTL_MS

  const instancesOf = (entry: E) =>
    store().items.filter((i) => i.store?.id === entry.id)

  // baseline 無通知記録 (#1040): sha512 未記録のインストール済みアイテムは、
  // レジストリ照会時に現行 entry.sha512 / version を無通知で基準記録し、次の
  // 変更から検知を始める (ローカルソースからの逆算は再シリアライズ形式のため
  // 不可能。誤って「全件更新あり」にしない)
  function recordBaselines(list: E[]): void {
    const s = store()
    for (const entry of list) {
      for (const inst of instancesOf(entry)) {
        if (inst.store?.sha512) continue
        void s.recordStoreBaseline(inst.id, {
          sha512: entry.sha512,
          version: entry.version,
        })
      }
    }
  }

  async function fetchIndex(): Promise<void> {
    if (isCacheValid() && entries.value.length > 0) return
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`${STORE_BASE_URL}/registry/${registryKey}.json`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      entries.value = data[registryKey] ?? []
      lastFetchedAt = Date.now()
      recordBaselines(entries.value)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'fetch failed'
    } finally {
      loading.value = false
    }
  }

  function refresh(): Promise<void> {
    lastFetchedAt = 0
    return fetchIndex()
  }

  const refetchEntry = (id: string) => async () => {
    await refresh()
    return entries.value.find((e) => e.id === id)
  }

  return {
    entries,
    loading,
    error,
    installing,
    fetch: fetchIndex,
    refresh,
    refetchEntry,
    isInstalled: (entry) => instancesOf(entry).length > 0,
    // 個体のどれか 1 つでも古ければ更新あり (#1061)
    hasUpdate: (entry) =>
      instancesOf(entry).some((i) =>
        hasStoreUpdate(i.store?.sha512, entry.sha512),
      ),
  }
}

// --- kind ごとの宣言 (#1202 段階 2) ---
// インストール / 更新 / インストール済み判定の手続きは 5 種で同じ:
//   取得 + sha 照合 → ソースを読む → storeId で既存を探す → 既存なら (sha が
//   違えば) 確認して本体とストア由来を上書き + 参加先を足す / 無ければ新規
//   (ローカル ID = storeId、占有時は連番 suffix)。
// kind ごとに違うのは「ソースの読み方」「新規個体の形」「確認を出す条件と diff」
// だけなので、それを宣言で受けて手続きは 1 本にする。

/** 配布ソースを読んだ結果。`patch` はそのまま store の `applyStoreUpdate` へ */
interface ParsedSource<Patch> {
  patch: Patch
}

interface StoreKind<
  E extends StoreEntryBase,
  Item extends DistributableMeta<unknown, unknown>,
  Patch,
  P extends ParsedSource<Patch>,
> {
  feed: RegistryFeed<E>
  store(): KindStore<Item, Patch>
  /** 更新確認のタイトル */
  title(): string
  /** 確認 diff の言語 */
  language: 'aiscript' | 'markdown' | 'json5'
  /** 配布ソースを読む。読めなければ throw (利用者向けの文で) */
  parse(source: string, entry: E, hash: string): P
  /** 新規個体を足す (kind の `add` の形。参加先はカラムの文脈から) */
  add(
    store: KindStore<Item, Patch>,
    parsed: P,
    entry: E,
    hash: string,
    id: string,
    targets: ScopeTarget[],
  ): Promise<Item | undefined>
  /**
   * 再インストールで確認を出す条件 (本体が変わるか)。plugin は本文の差では
   * 出さず、権限の拡大 (`caution`) だけで出す
   */
  changed(existing: Item, parsed: P): boolean
  /** 確認文に足す注意 (plugin の新しい権限)。あれば必ず確認し warning にする */
  caution?(existing: Item, parsed: P): string | null
  diff(existing: Item, parsed: P): { old: string; new: string }
}

function storeOrigin(
  e: StoreEntryBase,
  hash: string,
): DistributableStoreOrigin {
  return { id: e.id, sha512: hash, version: e.version }
}

const LIBRARY_ONLY: DistributableScope = {
  kind: 'shared',
  global: false,
  installedFor: [],
}

/** 参加先の一覧をスコープに畳む (無ければライブラリのみ) */
function scopeOf(targets: ScopeTarget[]): DistributableScope {
  return targets.reduce(withScopeTarget, LIBRARY_ONLY)
}

type PluginParsed = ParsedSource<PluginStorePatch> & {
  meta: ParsedPluginMeta
  source: string
}
type SkillParsed = ParsedSource<SkillStorePatch> & {
  meta: Frontmatter
  body: string
}
type SourceParsed = ParsedSource<StoreUpdatePatch<string>> & { source: string }
type ThemeParsed = ParsedSource<StoreUpdatePatch<ThemeContent>> & {
  content: ThemeContent
}

// --- Store ---

export const useMisStoreStore = defineStore('misstore', () => {
  const pluginFeed = createRegistryFeed<StorePluginEntry>('plugins', () =>
    usePluginsStore(),
  )
  const themeFeed = createRegistryFeed<StoreThemeEntry>('themes', () =>
    useThemeStore(),
  )
  const widgetFeed = createRegistryFeed<StoreWidgetEntry>('widgets', () =>
    useWidgetsStore(),
  )
  const skillFeed = createRegistryFeed<StoreSkillEntry>('skills', () =>
    useSkillsStore(),
  )
  const queryFeed = createRegistryFeed<StoreQueryEntry>('queries', () =>
    useColumnQueriesStore(),
  )

  // --- 検証付きソース取得 (#1040 リトライ) ---

  /**
   * 配布ソースを取得し sha512 を照合する。不一致のときは改ざん警告の前に
   * レジストリ index をキャッシュ無効化して再取得し、1 回だけリトライする
   * (ストア更新直後の TTL 内は正常な更新が偽の改ざん警告になるため)。
   * 再取得後も不一致なら従来どおり警告を投げる。
   */
  async function fetchVerifiedSource<E extends StoreEntryBase>(
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
    throw new Error(i18n.ts._misstore.hashMismatch)
  }

  async function fetchWidgetSource(entry: StoreWidgetEntry): Promise<string> {
    const { source } = await fetchVerifiedSource(
      entry,
      widgetFeed.refetchEntry(entry.id),
    )
    return source
  }

  // --- 5 種の宣言 ---

  const pluginKind: StoreKind<
    StorePluginEntry,
    PluginItem,
    PluginStorePatch,
    PluginParsed
  > = {
    feed: pluginFeed,
    store: () => usePluginsStore(),
    title: () => i18n.ts._misstore.updatePlugin,
    language: 'aiscript',
    parse(source, e, hash) {
      const meta = parsePluginMeta(source)
      if (!meta) throw new Error(i18n.ts._misstore.pluginMetaParseFailed)
      return {
        meta,
        source,
        patch: {
          content: source,
          version: meta.version,
          author: meta.author,
          description: meta.description,
          permissions: meta.permissions,
          config: meta.config,
          iconUrl: e.iconUrl,
          store: storeOrigin(e, hash),
        },
      }
    },
    // 有効で追加するので plugins store が起動まで行う
    add(store, { meta, source }, e, hash, id, targets) {
      const configData: Record<string, unknown> = {}
      for (const [key, def] of Object.entries(meta.config ?? {})) {
        configData[key] = def.default
      }
      return (store as unknown as ReturnType<typeof usePluginsStore>).add({
        id,
        name: meta.name,
        description: meta.description,
        ...(e.iconUrl ? { iconUrl: e.iconUrl } : {}),
        store: storeOrigin(e, hash),
        scope: scopeOf(targets),
        content: source,
        extra: {
          version: meta.version,
          author: meta.author,
          permissions: meta.permissions,
          config: meta.config,
          configData,
          active: true,
        },
      })
    },
    // 本文の差だけでは確認しない (再インストールは無言で更新)。権限が拡大する
    // なら再同意を通す (#1040 — 無確認にすると再同意の抜け穴になる)。既存側の
    // 記録が無いなど比較できない場合は拡大側に倒す (before = 空集合)
    changed: () => false,
    caution(existing, { meta }) {
      const before = new Set(existing.extra.permissions ?? [])
      const added = (meta.permissions ?? []).filter((p) => !before.has(p))
      return added.length > 0
        ? i18n.tsx._misstore.newPermissions({ permissions: added.join(', ') })
        : null
    },
    diff: (existing, { source }) => ({ old: existing.content, new: source }),
  }

  const widgetKind: StoreKind<
    StoreWidgetEntry,
    WidgetItem,
    StoreUpdatePatch<string>,
    SourceParsed
  > = {
    feed: widgetFeed,
    store: () => useWidgetsStore(),
    title: () => i18n.ts._misstore.updateWidget,
    language: 'aiscript',
    parse: (source, e, hash) => ({
      source,
      patch: {
        content: source,
        iconUrl: e.iconUrl,
        store: storeOrigin(e, hash),
      },
    }),
    // 本体は storeId につき 1 つ (#1202 決定 (b))。参加先を渡さなければ全体
    // スコープ (AI capability はカラム文脈を持たない)。カラムへの配置は後から
    // ユーザーが UI でやる
    add: (store, { source }, e, hash, id, targets) =>
      (store as unknown as ReturnType<typeof useWidgetsStore>).add({
        id,
        name: e.name,
        content: source,
        ...(e.iconUrl ? { iconUrl: e.iconUrl } : {}),
        store: storeOrigin(e, hash),
        scope:
          targets.length > 0
            ? scopeOf(targets)
            : { kind: 'shared', global: true, installedFor: [] },
        extra: { autoRun: e.autoRun },
      }),
    changed: (existing, { source }) => existing.content !== source,
    diff: (existing, { source }) => ({ old: existing.content, new: source }),
  }

  const queryKind: StoreKind<
    StoreQueryEntry,
    QueryItem,
    StoreUpdatePatch<string>,
    SourceParsed
  > = {
    feed: queryFeed,
    store: () => useColumnQueriesStore(),
    title: () => i18n.ts._misstore.updateQuery,
    language: 'aiscript',
    parse: (source, e, hash) => ({
      source,
      patch: {
        content: source,
        description: e.description,
        iconUrl: e.iconUrl,
        store: storeOrigin(e, hash),
      },
    }),
    // 配布はソースのみ・ローカルで必ず再コンパイルされる (#783 不変条件 (e))。
    // 導入してもカラムへの自動適用はしない (V18)。有効で入る (#1043)
    add: (store, { source }, e, hash, id, targets) =>
      (store as unknown as ReturnType<typeof useColumnQueriesStore>).add({
        id,
        ...(targets[0] ? { scope: targets[0] } : {}),
        name: e.name,
        description: e.description,
        content: source,
        iconUrl: e.iconUrl,
        store: storeOrigin(e, hash),
      }),
    changed: (existing, { source }) => existing.content !== source,
    diff: (existing, { source }) => ({ old: existing.content, new: source }),
  }

  const skillKind: StoreKind<
    StoreSkillEntry,
    SkillItem,
    SkillStorePatch,
    SkillParsed
  > = {
    feed: skillFeed,
    store: () => useSkillsStore(),
    title: () => i18n.ts._misstore.updateSkill,
    language: 'markdown',
    parse(source, e, hash) {
      const { meta, body } = parseSkillFile(source)
      return { meta, body, patch: buildSkillStorePatch(meta, body, e, hash) }
    },
    // 新規: ローカル ID = storeId (配布物内の ID 宣言よりレジストリのディレクトリ
    // 名を正とする)。インストール直後に有効化はしない (mode=always は常時有効)
    add(store, { meta, patch }, e, _hash, id) {
      const { content, description, iconUrl, store: origin, ...extra } = patch
      return (store as unknown as ReturnType<typeof useSkillsStore>).add({
        id,
        name: (meta.name as string | undefined) || e.name,
        description,
        iconUrl,
        store: origin,
        scope: { kind: 'none' },
        content,
        extra: {
          ...extra,
          mode:
            meta.mode === 'always' ||
            meta.mode === 'trigger' ||
            meta.mode === 'heartbeat'
              ? meta.mode
              : 'manual',
          builtIn: false,
        },
      })
    },
    // 本体 = frontmatter を除いた body 同士で比較する (ローカルは body しか
    // 保持しない。frontmatter 由来メタは patch 側が反映する)
    changed: (existing, { body }) => existing.content !== body,
    diff: (existing, { body }) => ({ old: existing.content, new: body }),
  }

  const themeKind: StoreKind<
    StoreThemeEntry,
    ThemeItem,
    StoreUpdatePatch<ThemeContent>,
    ThemeParsed
  > = {
    feed: themeFeed,
    store: () => useThemeStore(),
    title: () => i18n.ts._misstore.updateTheme,
    language: 'json5',
    parse(source, e, hash) {
      const content = parseThemeSource(source)
      return { content, patch: { content, store: storeOrigin(e, hash) } }
    },
    add: (store, { content }, e, hash, id, targets) =>
      (store as unknown as ReturnType<typeof useThemeStore>).add({
        id,
        name: e.name,
        store: storeOrigin(e, hash),
        scope: scopeOf(targets),
        content,
        extra: {},
      }),
    // 見た目が変わらない再インストール (別アカウントへの紐付け追加だけ) では
    // 確認を出さない。diff はファイルに書く形 (codec の projection) 同士
    changed: (existing, { content }) =>
      !sameThemeContent(existing.content, content),
    diff: (existing, { content, patch }) => ({
      old: themeCodec.encode(themeCodec.toFile(existing)),
      new: themeCodec.encode(
        themeCodec.toFile({ ...existing, content, store: patch.store }),
      ),
    }),
  }

  // --- 共通の手続き ---

  /**
   * 既存の個体へ配布ソースを適用する (#1040 / #981)。再インストールも本体を
   * 書き換える = ローカル編集が消えるので、kind の条件 (本体が変わる / 権限が
   * 拡大する) で確認を通す。`alwaysConfirm` = 更新操作 (差分の確認自体が目的)
   * は本体が同じでも確認する。承認後の再 fetch・再計算はしない — 見せたものと
   * 書くものの一致が承認 UI の意味そのもの (#981 不変条件)。
   * ローカル値 (ID / 改名 / 有効 / 参加先 / 設定値) は store 側の
   * `applyStoreUpdate` が維持する。
   *
   * @returns 適用したら true / ユーザーが拒否したら false
   */
  async function confirmAndApply<
    E extends StoreEntryBase,
    Item extends DistributableMeta<unknown, unknown>,
    Patch,
    P extends ParsedSource<Patch>,
  >(
    kind: StoreKind<E, Item, Patch, P>,
    store: KindStore<Item, Patch>,
    existing: Item,
    parsed: P,
    e: E,
    opts: { alwaysConfirm: boolean },
  ): Promise<boolean> {
    const caution = kind.caution?.(existing, parsed) ?? null
    if (
      opts.alwaysConfirm ||
      caution !== null ||
      kind.changed(existing, parsed)
    ) {
      let message = updateConfirmMessage(existing.name || e.name, e)
      if (caution !== null) message += `\n${caution}`
      const d = kind.diff(existing, parsed)
      const ok = await useConfirm().confirm({
        title: kind.title(),
        message,
        okLabel: i18n.ts._common.update,
        ...(caution !== null ? { type: 'warning' as const } : {}),
        diff: { old: d.old, new: d.new, language: kind.language },
      })
      if (!ok) return false
    }
    await store.applyStoreUpdate(existing.id, parsed.patch)
    return true
  }

  /**
   * MisStore からインストールする (#771 / #913 / #1202)。照合キーは storeId のみ
   * (同名の自作があってもインストール可能 — ファイル名は suffix が捌く)。
   * - 既存があれば: sha が違えば (= 中身が変わっていれば) 再インストール =
   *   更新として確認して上書きし、確認を断られても「この参加先へ入れる」操作
   *   自体は成立させる (中身は既存のまま)
   * - 無ければ新規 (ローカル ID = storeId、占有時は連番 suffix)
   * 戻り値は対象の個体 (存在すれば)
   */
  async function installFrom<
    E extends StoreEntryBase,
    Item extends DistributableMeta<unknown, unknown>,
    Patch,
    P extends ParsedSource<Patch>,
  >(
    kind: StoreKind<E, Item, Patch, P>,
    entry: E,
    targets: ScopeTarget[],
  ): Promise<Item | undefined> {
    kind.feed.installing.value = entry.id
    try {
      const store = kind.store()
      store.ensureLoaded()
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, kind.feed.refetchEntry(entry.id))
      const parsed = kind.parse(source, e, hash)
      const existing = store.items.find((i) => i.store?.id === e.id)
      if (existing) {
        // sha 一致 = 中身が同じなら本体に触れない (fetchVerifiedSource の
        // リトライで index が更新されていたら新 entry の値を記録する)
        if (existing.store?.sha512 !== hash) {
          await confirmAndApply(kind, store, existing, parsed, e, {
            alwaysConfirm: false,
          })
        }
        for (const target of targets) await store.link(existing.id, target)
        return store.items.find((i) => i.id === existing.id) ?? existing
      }
      const id = resolveAvailable(e.id, (c) =>
        store.items.some((i) => casefold(i.id) === c),
      )
      return await kind.add(store, parsed, e, hash, id, targets)
    } finally {
      kind.feed.installing.value = null
    }
  }

  /**
   * 更新を適用する (#1040)。更新ボタン → ソース fetch + sha 照合 (不一致は index
   * 再取得の 1 回リトライ) → 全文 diff 付き確認 → 承認で確認に使った内容を
   * そのまま適用。参加先には触れない (有効範囲はローカル値)。未インストールは
   * install の担当で false。戻り値は「適用したか」(キャンセル / 未インストールで
   * false)
   */
  async function updateFrom<
    E extends StoreEntryBase,
    Item extends DistributableMeta<unknown, unknown>,
    Patch,
    P extends ParsedSource<Patch>,
  >(kind: StoreKind<E, Item, Patch, P>, entry: E): Promise<boolean> {
    const store = kind.store()
    store.ensureLoaded()
    const existing = store.items.find((i) => i.store?.id === entry.id)
    if (!existing) return false
    kind.feed.installing.value = entry.id
    try {
      const {
        source,
        hash,
        entry: e,
      } = await fetchVerifiedSource(entry, kind.feed.refetchEntry(entry.id))
      return await confirmAndApply(
        kind,
        store,
        existing,
        kind.parse(source, e, hash),
        e,
        { alwaysConfirm: true },
      )
    } finally {
      kind.feed.installing.value = null
    }
  }

  /**
   * インストール済み判定。`target` を渡すと「その参加先に入っている個体が
   * あるか」で判定する (カラムのストアカードの粒度。未参加のスコープが残る
   * うちは通常の状態で出し、押せばそのスコープへ参加させる)
   */
  function isInstalledIn<E extends StoreEntryBase>(
    kind: { store(): KindStore<DistributableMeta<unknown, unknown>, unknown> },
    entry: E,
    target?: ScopeTarget,
  ): boolean {
    const store = kind.store()
    store.ensureLoaded()
    return store.items.some(
      (i) =>
        i.store?.id === entry.id &&
        (!target || hasScopeTarget(i.scope, target)),
    )
  }

  // --- 公開面 (kind で引く。カラム / deep link / テストが使う) ---

  const kinds: {
    [K in DistributableKind]: StoreKind<
      StoreEntryOf<K>,
      DistributableMeta<unknown, unknown>,
      unknown,
      ParsedSource<unknown>
    >
  } = {
    plugin: pluginKind,
    widget: widgetKind,
    query: queryKind,
    skill: skillKind,
    theme: themeKind,
  }

  /** レジストリの状態 (一覧 / 読込中 / エラー / 取得 / 再取得) */
  function feed<K extends DistributableKind>(
    kind: K,
  ): StoreFeedView<StoreEntryOf<K>> {
    const f = kinds[kind].feed
    return {
      get entries() {
        return f.entries.value
      },
      get loading() {
        return f.loading.value
      },
      get error() {
        return f.error.value
      },
      fetch: f.fetch,
      refresh: f.refresh,
    }
  }

  /**
   * ストアからインストールする。`targets` は参加させるスコープ (カラムの文脈。
   * plugin / query / widget は 1 つ、theme はアカウントの安定キーごと、skill は
   * 空)。既存なら中身が変わっているときだけ確認して適用し、参加先を足す。
   * 戻り値は対象の個体
   */
  function install<K extends DistributableKind>(
    kind: K,
    entry: StoreEntryOf<K>,
    targets: ScopeTarget[] = [],
  ): Promise<DistributableMeta<unknown, unknown> | undefined> {
    return installFrom(kinds[kind], entry, targets)
  }

  /** 更新を適用する (#1040)。戻り値は「適用したか」 */
  function update<K extends DistributableKind>(
    kind: K,
    entry: StoreEntryOf<K>,
  ): Promise<boolean> {
    return updateFrom(kinds[kind], entry)
  }

  /**
   * ストアカードの「インストール済み」判定 (全 kind 共通)。`target` を渡すと
   * カラムのスコープに参加している個体があるかで判定する (#1202 段階 3)
   */
  const installedIn = (
    kind: DistributableKind,
    entry: StoreEntryBase,
    target?: ScopeTarget,
  ) => isInstalledIn(kinds[kind], entry, target)

  /** 個体のどれか 1 つでも古ければ更新あり (#1061) */
  const hasUpdate = <K extends DistributableKind>(
    kind: K,
    entry: StoreEntryOf<K>,
  ) => kinds[kind].feed.hasUpdate(entry)

  /** インストール / 更新中の entry id (UI のスピナー用) */
  const installing = (kind: DistributableKind): string | null =>
    kinds[kind].feed.installing.value

  return {
    feed,
    install,
    update,
    installedIn,
    hasUpdate,
    installing,
    fetchWidgetSource,
  }
})

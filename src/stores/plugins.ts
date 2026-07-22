import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { planBuiltInSeed } from '@/services/builtInSeed'
import { createSidecarCollection } from '@/services/sidecarFileCollection'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { pushSnapshot } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageJson,
  removeStorageByPrefix,
  STORAGE_KEYS,
  setStorageJson,
} from '@/utils/storage'

interface BuiltInPluginTemplate {
  installId: string
  meta: PluginFileMeta
  src: string
}

/**
 * `@/defaults/plugins/*.is` + `*.meta.json5` を vite glob で読み込む。
 * 初回起動 / 後追い追加で seed する用 (skill の loadBuiltInTemplates と同型)。
 */
function loadBuiltInPluginTemplates(): BuiltInPluginTemplate[] {
  const srcModules = import.meta.glob('@/defaults/plugins/*.is', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  const metaModules = import.meta.glob('@/defaults/plugins/*.meta.json5', {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  const out: BuiltInPluginTemplate[] = []
  for (const [path, raw] of Object.entries(srcModules)) {
    const filename = path.split('/').pop() ?? ''
    const metaPath = path.replace(/\.is$/, '.meta.json5')
    const metaRaw = metaModules[metaPath] as string | undefined
    if (!metaRaw) {
      console.warn(`[plugins] built-in ${filename} has no meta sidecar`)
      continue
    }
    try {
      const meta = JSON5.parse(metaRaw) as PluginFileMeta
      out.push({
        installId: meta.installId,
        meta,
        src: raw as string,
      })
    } catch (e) {
      console.warn(`[plugins] failed to parse built-in ${metaPath}:`, e)
    }
  }
  return out
}

function pluginMetaToFullMeta(tpl: BuiltInPluginTemplate): PluginMeta {
  return {
    installId: tpl.meta.installId,
    name: tpl.meta.name,
    version: tpl.meta.version,
    author: tpl.meta.author,
    description: tpl.meta.description,
    permissions: tpl.meta.permissions,
    config: tpl.meta.config,
    configData: tpl.meta.configData || {},
    src: tpl.src,
    active: tpl.meta.active ?? true,
    global: tpl.meta.global,
    installedFor: tpl.meta.installedFor,
    storeId: tpl.meta.storeId,
    iconUrl: tpl.meta.iconUrl,
  }
}

export interface PluginConfigDef {
  type: 'string' | 'number' | 'boolean'
  label: string
  description?: string
  default: unknown
}

export interface PluginMeta {
  installId: string
  name: string
  version: string
  author?: string
  description?: string
  permissions?: string[]
  config?: Record<string, PluginConfigDef>
  configData: Record<string, unknown>
  src: string
  active: boolean
  /** 全体スコープ参加 (#771)。true なら全アカウント (後から追加した分も含む) で
   *  有効。全アカウントカラムで追加したプラグインはこちら。 */
  global?: boolean
  /** アカウント別スコープ参加 (#771)。`accountScopeKey` (host:userId) の配列。
   *  再ログインで再生成される内部 UUID ではなく安定キーで持つ。
   *  global と installedFor の両方が無いものはどこにも効かない (ライブラリのみ)。 */
  installedFor?: string[]
  /** misstore 由来の追跡 ID (将来の自動更新用) */
  storeId?: string
  /** 個別アイコン URL (MisStore registry の iconUrl 互換) */
  iconUrl?: string
}

/** インストール/追加先スコープ (#771)。カラムの文脈から決まる。 */
export type PluginScope = { kind: 'global' } | { kind: 'account'; key: string }

let builtInIdCache: Set<string> | null = null

/** アプリ同梱 (defaults/plugins seed) 由来のプラグインか。セクション分類用。 */
export function isBuiltInPlugin(installId: string): boolean {
  if (!builtInIdCache) {
    builtInIdCache = new Set(
      loadBuiltInPluginTemplates().map((t) => t.installId),
    )
  }
  return builtInIdCache.has(installId)
}

/**
 * plugin が scopeKey (`accountScopeKey`) のアカウントに効くか。
 * scopeKey=null は「アカウント文脈なし」= 全体スコープのみ有効。
 */
export function isPluginEffectiveFor(
  plugin: PluginMeta,
  scopeKey: string | null,
): boolean {
  if (plugin.global) return true
  if (!scopeKey) return false
  return plugin.installedFor?.includes(scopeKey) ?? false
}

/** Metadata fields stored in *.meta.json5 (everything except src). */
interface PluginFileMeta {
  installId: string
  name: string
  version: string
  author?: string
  description?: string
  permissions?: string[]
  config?: Record<string, PluginConfigDef>
  configData: Record<string, unknown>
  active: boolean
  global?: boolean
  installedFor?: string[]
  storeId?: string
  iconUrl?: string
}

/** .is + .meta.json5 ペアのファイル永続化 (#782 Phase 2、widgets と共通) */
const pluginFiles = createSidecarCollection<PluginMeta, PluginFileMeta>({
  logTag: 'plugins',
  // 直接参照ではなくアロー包みで遅延参照する (テストの部分モックと相性を保つ)
  srcFilename: (base) => settingsFs.pluginSrcFilename(base),
  metaFilename: (base) => settingsFs.pluginMetaFilename(base),
  list: () => settingsFs.listPluginFiles(),
  read: (filename) => settingsFs.readPluginFile(filename),
  write: (filename, content) => settingsFs.writePluginFile(filename, content),
  remove: (filename) => settingsFs.deletePluginFile(filename),
  baseName: (p) => p.name || p.installId,
  srcOf: (p) => p.src,
  toFileMeta: (p) => ({
    installId: p.installId,
    name: p.name,
    version: p.version,
    ...(p.author ? { author: p.author } : {}),
    ...(p.description ? { description: p.description } : {}),
    ...(p.permissions?.length ? { permissions: p.permissions } : {}),
    ...(p.config ? { config: p.config } : {}),
    configData: p.configData,
    active: p.active,
    ...(p.global ? { global: true } : {}),
    ...(p.installedFor?.length ? { installedFor: p.installedFor } : {}),
    ...(p.storeId ? { storeId: p.storeId } : {}),
    ...(p.iconUrl ? { iconUrl: p.iconUrl } : {}),
  }),
  fromFile: (meta, src, metaFile) => ({
    installId: meta.installId || metaFile,
    name: meta.name || metaFile,
    version: meta.version || '0.0.0',
    author: meta.author,
    description: meta.description,
    permissions: meta.permissions,
    config: meta.config,
    configData: meta.configData || {},
    src,
    active: meta.active ?? false,
    global: meta.global,
    installedFor: meta.installedFor,
    storeId: meta.storeId,
    iconUrl: meta.iconUrl,
  }),
})

function loadPluginsFromStorage(): PluginMeta[] {
  return getStorageJson<PluginMeta[]>(STORAGE_KEYS.plugins, [])
}

function savePluginsToStorage(plugins: PluginMeta[]) {
  setStorageJson(STORAGE_KEYS.plugins, plugins)
}

export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginMeta[]>([])
  let loaded = false
  const initialized = ref(false)

  function ensureLoaded() {
    if (loaded) return
    loaded = true
    plugins.value = loadPluginsFromStorage()

    // Kick off file-based init (Tauri only)
    if (settingsFs.isTauri) {
      initFileStorage().catch((e) =>
        console.warn('[plugins] file storage init failed:', e),
      )
    } else {
      initialized.value = true
      // ブラウザ環境 (ファイル I/O なし) でも built-in を seed して
      // 動作確認ができるようにする
      seedMissingBuiltIns()
        .then(() => scheduleScopeMigration())
        .catch((e) => console.warn('[plugins] built-in seed failed:', e))
    }
  }

  const activePlugins = computed(() => {
    ensureLoaded()
    return plugins.value.filter((p) => p.active)
  })

  function persist(plugin?: PluginMeta) {
    savePluginsToStorage(plugins.value)
    if (initialized.value) {
      const task = plugin
        ? pluginFiles.persistItem(plugin)
        : pluginFiles.persistAll(plugins.value)
      task.catch((e) =>
        console.warn('[plugins] failed to persist to files:', e),
      )
    }
  }

  /** Load plugins from files. Files are source of truth. */
  async function initFileStorage(): Promise<void> {
    const { items: filePlugins, entryFileCount } = await pluginFiles.loadAll()

    if (filePlugins.length > 0) {
      plugins.value = filePlugins
      savePluginsToStorage(filePlugins)
    }

    initialized.value = true

    // Migrate: localStorage has plugins but no files exist
    if (entryFileCount === 0 && plugins.value.length > 0) {
      pluginFiles
        .persistAll(plugins.value)
        .catch((e) => console.warn('[plugins] migration to files failed:', e))
    }

    // Seed built-in plugins (初回起動 + 後追い追加に対応)。
    await seedMissingBuiltIns()

    // レガシー紐付けのスコープ移行 (#771)。files が source of truth に
    // なった後で走らせる。
    scheduleScopeMigration()
  }

  /**
   * `src/defaults/plugins/` 配下のテンプレートを seed する。
   *
   * - 既に同 installId のプラグインがある → ユーザー編集を尊重して何もしない
   * - 過去に seed したことがある (= ユーザーが削除した) → 再生成しない
   * - 未知の built-in installId だけが対象
   *
   * skill の seedMissingBuiltIns と同型 (storage key も対応関係にある)。
   */
  async function seedMissingBuiltIns(): Promise<void> {
    const templates = loadBuiltInPluginTemplates()
    if (templates.length === 0) return

    const { toAdd, seededIds } = planBuiltInSeed(
      templates,
      (tpl) => tpl.installId,
      new Set(plugins.value.map((p) => p.installId)),
      new Set(getStorageJson<string[]>(STORAGE_KEYS.pluginsSeededBuiltins, [])),
    )

    if (toAdd.length > 0) {
      const added = toAdd.map(pluginMetaToFullMeta)
      plugins.value = [...plugins.value, ...added]
      savePluginsToStorage(plugins.value)
      if (initialized.value) {
        await pluginFiles
          .persistAll(added)
          .catch((e) =>
            console.warn('[plugins] failed to seed built-in plugin files:', e),
          )
      }
    }
    setStorageJson(STORAGE_KEYS.pluginsSeededBuiltins, seededIds)
  }

  function addPlugin(plugin: PluginMeta) {
    ensureLoaded()
    plugins.value.push(plugin)
    persist(plugin)
  }

  function removePlugin(installId: string) {
    ensureLoaded()
    const removed = plugins.value.find((p) => p.installId === installId)
    // Clean up plugin localStorage entries
    removeStorageByPrefix(STORAGE_KEYS.aiscriptPlugin(installId))
    plugins.value = plugins.value.filter((p) => p.installId !== installId)
    // Sync: localStorage only (file deletion handles the rest)
    savePluginsToStorage(plugins.value)
    // Delete files
    if (initialized.value && removed) {
      pluginFiles
        .deleteItemFiles(removed)
        .catch((e) =>
          console.warn('[plugins] failed to delete plugin files:', e),
        )
    }
  }

  /** 全体スコープに参加させる。全アカウントカラムからのインストール/追加用。 */
  function linkGlobalScope(installId: string) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin || plugin.global) return
    plugin.global = true
    persist(plugin)
  }

  /** 全体スコープから外す。本体はライブラリに残る (widgets の detach と同型)。 */
  function unlinkGlobalScope(installId: string) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin?.global) return
    plugin.global = undefined
    persist(plugin)
  }

  /** アカウント別スコープ (`accountScopeKey`) に参加させる (union)。 */
  function linkAccountScope(installId: string, scopeKey: string) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return
    const existing = plugin.installedFor ?? []
    if (existing.includes(scopeKey)) return
    plugin.installedFor = [...existing, scopeKey]
    persist(plugin)
  }

  /** アカウント別スコープから外す。本体はライブラリに残る。 */
  function unlinkAccountScope(installId: string, scopeKey: string) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin?.installedFor) return
    const remaining = plugin.installedFor.filter((k) => k !== scopeKey)
    plugin.installedFor = remaining.length > 0 ? remaining : undefined
    persist(plugin)
  }

  /** scope に応じて linkGlobalScope / linkAccountScope へ振り分ける。 */
  function linkScope(installId: string, scope: PluginScope) {
    if (scope.kind === 'global') linkGlobalScope(installId)
    else linkAccountScope(installId, scope.key)
  }

  /** scope に応じて unlinkGlobalScope / unlinkAccountScope へ振り分ける。 */
  function unlinkScope(installId: string, scope: PluginScope) {
    if (scope.kind === 'global') unlinkGlobalScope(installId)
    else unlinkAccountScope(installId, scope.key)
  }

  /** 安定キーは host:userId 形式で必ず ':' を含む。旧 UUID には含まれない。 */
  const isScopeKey = (v: string) => v.includes(':')

  let scopesMigrated = false

  /**
   * レガシー紐付けの一括移行 (#771)。アカウント一覧が必要なので
   * accounts ロード後に 1 回だけ走る。
   * - global / installedFor とも無し (旧: 全アカウント対象) → global: true
   * - installedFor の旧 UUID → 現行アカウントに該当すれば安定キーへ置換、
   *   該当しなければ破棄 (再ログインで UUID が変わった痕跡)
   * - 置換の結果 空 (紐付け先が全滅したゾンビ) → global: true で救済
   * - 置換の結果 全現行アカウントをカバー (旧 全アカウントカラムの
   *   スナップショット) → global: true に昇格
   * 安定キーのみのプラグインには触れない (冪等)。
   */
  function migrateScopes() {
    const accountsStore = useAccountsStore()
    if (!accountsStore.isLoaded || scopesMigrated) return
    scopesMigrated = true
    ensureLoaded()

    const uuidToKey = new Map(
      accountsStore.accounts.map((a) => [a.id, accountScopeKey(a)]),
    )
    const allKeys = accountsStore.accounts.map((a) => accountScopeKey(a))

    for (const plugin of plugins.value) {
      if (plugin.global) continue
      const list = plugin.installedFor ?? []
      if (list.length === 0) {
        if (plugin.installedFor !== undefined) plugin.installedFor = undefined
        plugin.global = true
        persist(plugin)
        continue
      }
      if (list.every(isScopeKey)) continue // 移行済み

      const mapped = Array.from(
        new Set(list.map((v) => (isScopeKey(v) ? v : uuidToKey.get(v)))),
      ).filter((v): v is string => !!v)

      if (
        mapped.length === 0 ||
        (allKeys.length > 0 && allKeys.every((k) => mapped.includes(k)))
      ) {
        plugin.global = true
        plugin.installedFor = undefined
      } else {
        plugin.installedFor = mapped
      }
      persist(plugin)
    }
  }

  /** accounts のロード完了を待って migrateScopes を 1 回だけ実行する。 */
  function scheduleScopeMigration() {
    const accountsStore = useAccountsStore()
    if (accountsStore.isLoaded) {
      migrateScopes()
      return
    }
    const stop = watch(
      () => accountsStore.isLoaded,
      (ready) => {
        if (!ready) return
        stop()
        migrateScopes()
      },
    )
  }

  function setActive(installId: string, active: boolean) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (plugin) {
      plugin.active = active
      persist(plugin)
    }
  }

  function updateConfigData(installId: string, data: Record<string, unknown>) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (plugin) {
      plugin.configData = data
      persist(plugin)
    }
  }

  function updateSrc(installId: string, src: string) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (plugin) {
      // 編集前 src を history sidecar に push (fire-and-forget)
      pushSnapshot('plugin', plugin.name || plugin.installId, {
        src: plugin.src,
        name: plugin.name,
        version: plugin.version,
        permissions: plugin.permissions,
        active: plugin.active,
      }).catch((e) => console.warn('[plugins] history push failed:', e))
      plugin.src = src
      persist(plugin)
    }
  }

  function renamePlugin(installId: string, newName: string) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return

    const oldBaseName = plugin.name || plugin.installId
    plugin.name = newName

    persist(plugin)

    if (initialized.value && oldBaseName !== newName) {
      // Delete old files and write new ones (installId stays the same)
      pluginFiles
        .deleteItemFiles({ ...plugin, name: oldBaseName })
        .catch((e) =>
          console.warn('[plugins] failed to delete old plugin files:', e),
        )
    }
  }

  function getPlugin(installId: string): PluginMeta | undefined {
    ensureLoaded()
    return plugins.value.find((p) => p.installId === installId)
  }

  function isDuplicate(name: string): boolean {
    ensureLoaded()
    return plugins.value.some((p) => p.name === name)
  }

  return {
    plugins,
    activePlugins,
    ensureLoaded,
    addPlugin,
    removePlugin,
    linkGlobalScope,
    unlinkGlobalScope,
    linkAccountScope,
    unlinkAccountScope,
    linkScope,
    unlinkScope,
    migrateScopes,
    renamePlugin,
    setActive,
    updateConfigData,
    updateSrc,
    getPlugin,
    isDuplicate,
  }
})

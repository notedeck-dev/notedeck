import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { planBuiltInSeed } from '@/services/builtInSeed'
import {
  createSidecarCollection,
  type SidecarItemFile,
} from '@/services/sidecarFileCollection'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { pushSnapshot } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageByPrefix,
  getStorageJson,
  removeStorageByPrefix,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
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

export interface PluginMeta extends SidecarItemFile {
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
  kindFallback: 'plugin',
  idKey: 'installId',
  // 直接参照ではなくアロー包みで遅延参照する (テストの部分モックと相性を保つ)
  list: () => settingsFs.listPluginFiles(),
  read: (filename) => settingsFs.readPluginFile(filename),
  write: (filename, content) => settingsFs.writePluginFile(filename, content),
  remove: (filename) => settingsFs.deletePluginFile(filename),
  rename: (oldFilename, newFilename) =>
    settingsFs.renamePluginFile(oldFilename, newFilename),
  idOf: (p) => p.installId,
  nameOf: (p) => p.name,
  srcOf: (p) => p.src,
  mirrorSrcById: (id) =>
    loadPluginsFromStorage().find((p) => p.installId === id)?.src,
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
  // 変更系操作 (新規作成・リネーム・保存・削除) のファイル反映は
  // 「初回読込 (対応表確定) + 初回移行」の完了を待つゲート (#913)
  let resolveReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  function ensureLoaded() {
    if (loaded) return
    loaded = true
    plugins.value = loadPluginsFromStorage()

    // Kick off file-based init (Tauri only)
    if (settingsFs.isTauri) {
      initFileStorage()
        .catch((e) => console.warn('[plugins] file storage init failed:', e))
        .finally(() => resolveReady?.())
    } else {
      initialized.value = true
      resolveReady?.()
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

  /** 保存・削除の直前にミラーの対応表を読み直す (別ウィンドウのリネーム追随)。 */
  function adoptMirrorFileBase(plugin: PluginMeta) {
    const mirrored = loadPluginsFromStorage().find(
      (p) => p.installId === plugin.installId,
    )
    if (mirrored?.fileBase) plugin.fileBase = mirrored.fileBase
  }

  function persist(plugin?: PluginMeta) {
    savePluginsToStorage(plugins.value)
    if (!settingsFs.isTauri) return
    void ready
      .then(async () => {
        if (plugin) {
          adoptMirrorFileBase(plugin)
          await pluginFiles.persistItem(plugin, plugins.value)
        } else {
          await pluginFiles.persistAll(plugins.value, plugins.value)
        }
        // fileBase 割当をミラーへ反映
        savePluginsToStorage(plugins.value)
      })
      .catch((e) => console.warn('[plugins] failed to persist to files:', e))
  }

  /** Load plugins from files. Files are source of truth. */
  async function initFileStorage(): Promise<void> {
    const { items: filePlugins } = await pluginFiles.loadAll()

    // 初期化中にメモリ追加された plugin と、ミラーにだけ在る plugin
    // (過去の書込が黙って失敗した個体) の集合。
    const fileIds = new Set(filePlugins.map((p) => p.installId))
    const memoryOnly = plugins.value.filter((p) => !fileIds.has(p.installId))

    if (filePlugins.length > 0) {
      plugins.value = [...filePlugins, ...memoryOnly]
    }

    // マイグレーション (#913) はメインウィンドウのみが実行する。冪等
    if (settingsFs.isMainDeckWindow()) {
      // (a) 規約外名の copy-adopt 正規化
      await pluginFiles.migrateItems(plugins.value)
      // (b) ミラー在・ファイル不在 → 新 slug 名で再作成 (空ソースは書かない)
      for (const p of memoryOnly) {
        if (p.readOnly || !p.src) continue
        p.fileBase = undefined // ミラー由来の旧 fileBase は無効 (ファイル不在)
        await pluginFiles
          .persistItem(p, plugins.value)
          .catch((e) =>
            console.warn('[plugins] failed to persist memory-only plugins:', e),
          )
      }
      // 履歴 sweep: 主ファイルと対応の取れない .history.json5 を削除
      await pluginFiles
        .sweepHistory()
        .catch((e) => console.warn('[plugins] history sweep failed:', e))
    }

    savePluginsToStorage(plugins.value)
    initialized.value = true

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
      if (settingsFs.isTauri) {
        await pluginFiles
          .persistAll(added, plugins.value)
          .catch((e) =>
            console.warn('[plugins] failed to seed built-in plugin files:', e),
          )
        savePluginsToStorage(plugins.value)
      }
    }
    setStorageJson(STORAGE_KEYS.pluginsSeededBuiltins, seededIds)
  }

  function addPlugin(plugin: PluginMeta) {
    ensureLoaded()
    plugins.value.push(plugin)
    persist(plugin)
  }

  /**
   * プラグインをライブラリから削除する。削除を取り消す undo を返す (#988 —
   * skill / widget と同じ「confirm → 削除 → 元に戻すトースト」に揃えるため)。
   * 未知の installId なら undefined。
   */
  function removePlugin(installId: string): (() => void) | undefined {
    ensureLoaded()
    const idx = plugins.value.findIndex((p) => p.installId === installId)
    const removed = plugins.value[idx]
    // ミラー上書き前に対応表を読み直す (別ウィンドウのリネーム後の削除が
    // stale なファイル名で空振りしないように)
    if (removed && settingsFs.isTauri) adoptMirrorFileBase(removed)
    // Clean up plugin localStorage entries
    // undo で戻せるよう消す前にスナップショットを取る (widgets と同型)
    const storagePrefix = STORAGE_KEYS.aiscriptPlugin(installId)
    const savedStorage = getStorageByPrefix(storagePrefix)
    removeStorageByPrefix(storagePrefix)
    plugins.value = plugins.value.filter((p) => p.installId !== installId)
    // Sync: localStorage only (file deletion handles the rest)
    savePluginsToStorage(plugins.value)
    // Delete files
    if (settingsFs.isTauri && removed) {
      void ready
        .then(() => pluginFiles.deleteItemFiles(removed))
        .catch((e) =>
          console.warn('[plugins] failed to delete plugin files:', e),
        )
    }
    if (!removed) return undefined
    return () => {
      if (plugins.value.some((p) => p.installId === installId)) return
      const at = Math.min(idx, plugins.value.length)
      plugins.value = [
        ...plugins.value.slice(0, at),
        removed,
        ...plugins.value.slice(at),
      ]
      savePluginsToStorage(plugins.value)
      for (const [key, value] of Object.entries(savedStorage)) {
        setStorageString(key, value)
      }
      if (settingsFs.isTauri) {
        void ready
          .then(() => pluginFiles.persistItem(removed, plugins.value))
          .then(() => savePluginsToStorage(plugins.value))
          .catch((e) =>
            console.warn('[plugins] failed to restore plugin files:', e),
          )
      }
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
      if (plugin.readOnly) {
        // ソース欠損の読取専用個体: 内容編集と保存を抑止 (#913)
        console.warn('[plugins] read-only plugin — src update suppressed')
        return
      }
      // 編集前 src を history sidecar に push (fire-and-forget)。
      // 履歴キーは対応表の fileBase (未割当 = ファイル未作成なら履歴も無し)
      if (plugin.fileBase) {
        pushSnapshot('plugin', plugin.fileBase, {
          src: plugin.src,
          name: plugin.name,
          version: plugin.version,
          permissions: plugin.permissions,
          active: plugin.active,
        }).catch((e) => console.warn('[plugins] history push failed:', e))
      }
      plugin.src = src
      persist(plugin)
    }
  }

  function renamePlugin(installId: string, newName: string) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return

    plugin.name = newName
    savePluginsToStorage(plugins.value)
    if (!settingsFs.isTauri) return
    // ファイルは rename で追随させる (ID 不変・旧削除 + 新書込の並行発火禁止)。
    // rename の完了を待ってから保存する
    void ready
      .then(async () => {
        adoptMirrorFileBase(plugin)
        await pluginFiles.renameItemFiles(plugin, plugins.value)
        await pluginFiles.persistItem(plugin, plugins.value)
        savePluginsToStorage(plugins.value)
      })
      .catch((e) => console.warn('[plugins] failed to rename plugin files:', e))
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

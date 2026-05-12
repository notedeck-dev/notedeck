import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
  /** どの account の per-account プラグインカラム / handler 発火対象に含めるか。
   *  - 空 / undefined: 後方互換で全 account 対象 (旧プラグイン)
   *  - 1 つ以上: 該当 account のみで handler 発火 (per-account 有効化) */
  installedFor?: string[]
  /** misstore 由来の追跡 ID (将来の自動更新用) */
  storeId?: string
  /** 個別アイコン URL (MisStore registry の iconUrl 互換) */
  iconUrl?: string
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
  installedFor?: string[]
  storeId?: string
  iconUrl?: string
}

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
      seedMissingBuiltIns().catch((e) =>
        console.warn('[plugins] built-in seed failed:', e),
      )
    }
  }

  const activePlugins = computed(() => {
    ensureLoaded()
    return plugins.value.filter((p) => p.active)
  })

  function persist(plugin?: PluginMeta) {
    savePluginsToStorage(plugins.value)
    if (initialized.value) {
      const task = plugin ? persistSinglePlugin(plugin) : persistAllToFiles()
      task.catch((e) =>
        console.warn('[plugins] failed to persist to files:', e),
      )
    }
  }

  /** Write a single plugin to its .is and .meta.json5 files. */
  async function persistSinglePlugin(plugin: PluginMeta): Promise<void> {
    const baseName = plugin.name || plugin.installId
    const srcFilename = settingsFs.pluginSrcFilename(baseName)
    const metaFilename = settingsFs.pluginMetaFilename(baseName)

    const meta: PluginFileMeta = {
      installId: plugin.installId,
      name: plugin.name,
      version: plugin.version,
      ...(plugin.author ? { author: plugin.author } : {}),
      ...(plugin.description ? { description: plugin.description } : {}),
      ...(plugin.permissions?.length
        ? { permissions: plugin.permissions }
        : {}),
      ...(plugin.config ? { config: plugin.config } : {}),
      configData: plugin.configData,
      active: plugin.active,
      ...(plugin.installedFor?.length
        ? { installedFor: plugin.installedFor }
        : {}),
      ...(plugin.storeId ? { storeId: plugin.storeId } : {}),
      ...(plugin.iconUrl ? { iconUrl: plugin.iconUrl } : {}),
    }
    await Promise.all([
      settingsFs.writePluginFile(srcFilename, plugin.src),
      settingsFs.writePluginFile(metaFilename, JSON5.stringify(meta, null, 2)),
    ])
  }

  /** Write all plugins to files. */
  async function persistAllToFiles(): Promise<void> {
    await Promise.all(plugins.value.map((p) => persistSinglePlugin(p)))
  }

  /** Delete a plugin's files. */
  async function deletePluginFiles(plugin: PluginMeta): Promise<void> {
    const baseName = plugin.name || plugin.installId
    await Promise.all([
      settingsFs.deletePluginFile(settingsFs.pluginSrcFilename(baseName)),
      settingsFs.deletePluginFile(settingsFs.pluginMetaFilename(baseName)),
    ])
  }

  /** Load plugins from files. Files are source of truth. */
  async function initFileStorage(): Promise<void> {
    const allFiles = await settingsFs.listPluginFiles()
    const metaFiles = allFiles.filter((f) => f.endsWith('.meta.json5'))

    if (metaFiles.length > 0) {
      const results = await Promise.all(
        metaFiles.map(async (metaFile) => {
          try {
            const srcFile = metaFile.replace(/\.meta\.json5$/, '.is')
            const [metaContent, src] = await Promise.all([
              settingsFs.readPluginFile(metaFile),
              allFiles.includes(srcFile)
                ? settingsFs.readPluginFile(srcFile)
                : Promise.resolve(''),
            ])
            const meta = JSON5.parse(metaContent) as PluginFileMeta
            return {
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
              installedFor: meta.installedFor,
              storeId: meta.storeId,
              iconUrl: meta.iconUrl,
            } as PluginMeta
          } catch (e) {
            console.warn(`[plugins] failed to parse ${metaFile}:`, e)
            return null
          }
        }),
      )
      const filePlugins = results.filter((p): p is PluginMeta => p !== null)

      if (filePlugins.length > 0) {
        plugins.value = filePlugins
        savePluginsToStorage(filePlugins)
      }
    }

    initialized.value = true

    // Migrate: localStorage has plugins but no files exist
    if (metaFiles.length === 0 && plugins.value.length > 0) {
      persistAllToFiles().catch((e) =>
        console.warn('[plugins] migration to files failed:', e),
      )
    }

    // Seed built-in plugins (初回起動 + 後追い追加に対応)。
    await seedMissingBuiltIns()
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

    const seenIds = new Set(plugins.value.map((p) => p.installId))
    const previouslySeeded = new Set(
      getStorageJson<string[]>(STORAGE_KEYS.pluginsSeededBuiltins, []),
    )

    const toAdd: PluginMeta[] = []
    for (const tpl of templates) {
      if (seenIds.has(tpl.installId)) {
        previouslySeeded.add(tpl.installId)
        continue
      }
      if (previouslySeeded.has(tpl.installId)) continue
      toAdd.push(pluginMetaToFullMeta(tpl))
    }

    if (toAdd.length === 0) {
      setStorageJson(
        STORAGE_KEYS.pluginsSeededBuiltins,
        Array.from(previouslySeeded),
      )
      return
    }

    plugins.value = [...plugins.value, ...toAdd]
    savePluginsToStorage(plugins.value)
    if (initialized.value) {
      await Promise.all(toAdd.map((p) => persistSinglePlugin(p))).catch((e) =>
        console.warn('[plugins] failed to seed built-in plugin files:', e),
      )
    }
    for (const p of toAdd) previouslySeeded.add(p.installId)
    setStorageJson(
      STORAGE_KEYS.pluginsSeededBuiltins,
      Array.from(previouslySeeded),
    )
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
      deletePluginFiles(removed).catch((e) =>
        console.warn('[plugins] failed to delete plugin files:', e),
      )
    }
  }

  /**
   * プラグインの `installedFor` に accountIds を追加 (union)。
   * misstore.installPlugin / per-account エディタ保存等で使う。
   */
  function linkAccountToPlugin(installId: string, accountIds: string[]) {
    if (accountIds.length === 0) return
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return
    const existing = plugin.installedFor ?? []
    plugin.installedFor = Array.from(new Set([...existing, ...accountIds]))
    persist(plugin)
  }

  /**
   * プラグインの per-account 紐付け (`installedFor`) から accountId を外す。
   * installedFor が空になれば plugins から完全削除する。
   * per-account プラグインカラムでの「× ボタン」=「このアカウントから外す」用。
   */
  function unlinkAccountFromPlugin(installId: string, accountId: string) {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin || !plugin.installedFor) {
      // installedFor が無い (= 全 account 対象 / 旧プラグイン) は per-account
      // 単独除去の対象外。完全削除は cross-account カラムから行う想定。
      return
    }
    const remaining = plugin.installedFor.filter((id) => id !== accountId)
    if (remaining.length === 0) {
      removePlugin(installId)
      return
    }
    plugin.installedFor = remaining
    persist(plugin)
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
      deletePluginFiles({ ...plugin, name: oldBaseName } as PluginMeta).catch(
        (e) => console.warn('[plugins] failed to delete old plugin files:', e),
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
    linkAccountToPlugin,
    unlinkAccountFromPlugin,
    renamePlugin,
    setActive,
    updateConfigData,
    updateSrc,
    getPlugin,
    isDuplicate,
  }
})

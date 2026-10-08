import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import {
  createSidecarCollection,
  META_SUFFIX,
  type SidecarItemFile,
} from '@/services/sidecarFileCollection'
import { planStoreMovedPluginMigration } from '@/services/storeMovedPlugins'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { type EditAttribution, pushSnapshot } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageByPrefix,
  getStorageJson,
  removeStorageByPrefix,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
} from '@/utils/storage'
import { notifyWarningToast } from '@/utils/toastNotify'

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
  /** インストール/更新時に照合済みの配布ソース SHA-512 (#913。更新検知 #1040 の baseline) */
  storeSha512?: string
  /** インストール/更新時の registry バージョン (#913) */
  storeVersion?: string
  /** 個別アイコン URL (MisStore registry の iconUrl 互換) */
  iconUrl?: string
  /**
   * 作成 / 最終更新時刻 (ms)。#1202 段階 0 でファイルに足した (widget / query /
   * skill と同じ)。ファイルから読んだ個体は必ず持ち (無ければ読込時に今を入れて
   * メインウィンドウが書き戻す)、メモリで作った個体は `addPlugin` が埋める。
   * 段階 1 (envelope) で必須になる
   */
  createdAt?: number
  updatedAt?: number
}

/** インストール/追加先スコープ (#771)。カラムの文脈から決まる。 */
export type PluginScope = { kind: 'global' } | { kind: 'account'; key: string }

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
  storeSha512?: string
  storeVersion?: string
  iconUrl?: string
  createdAt: number
  updatedAt: number
}

/**
 * item → meta ファイルの projection。キー順と省略規則は notecore の
 * `sidecar/plugins.rs` `normalize_meta` と、codec (`services/distributableCodecs/
 * pluginCodec.ts`) の出力と一致する (storeParity.test / golden が固定)
 */
function pluginToFileMeta(p: PluginMeta): PluginFileMeta {
  return {
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
    ...(p.storeSha512 ? { storeSha512: p.storeSha512 } : {}),
    ...(p.storeVersion ? { storeVersion: p.storeVersion } : {}),
    ...(p.iconUrl ? { iconUrl: p.iconUrl } : {}),
    // addPlugin が埋めるので通常は到達しない (保険)
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  }
}

function pluginFromFile(
  meta: PluginFileMeta,
  src: string,
  metaFile: string,
): PluginMeta {
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
    global: meta.global,
    installedFor: meta.installedFor,
    storeId: meta.storeId,
    storeSha512: meta.storeSha512,
    storeVersion: meta.storeVersion,
    iconUrl: meta.iconUrl,
    createdAt: meta.createdAt ?? Date.now(),
    updatedAt: meta.updatedAt ?? Date.now(),
  }
}

/**
 * 内部関数の test 用 export (codec との一致検査)。プロダクトコードから直接
 * 呼ばないこと
 */
export const _internal = {
  toFileMeta: pluginToFileMeta,
  fromFile: pluginFromFile,
}

/** .is + .meta.json5 ペアのファイル永続化 (#782 Phase 2、widgets と共通) */
const pluginFiles = createSidecarCollection<PluginMeta, PluginFileMeta>({
  logTag: 'plugins',
  notify: notifyWarningToast,
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
  // ストアインストールはファイル名 = storeId (#913。占有時は連番 suffix)
  preferredBase: (p) => p.storeId,
  toFileMeta: pluginToFileMeta,
  fromFile: pluginFromFile,
  // #1202 段階 0: createdAt / updatedAt の無い旧ファイルは書き戻して揃える
  isOutdated: (meta) =>
    typeof meta.createdAt !== 'number' || typeof meta.updatedAt !== 'number',
})

// ブラウザ dev モード (Tauri 外) だけの永続化。Tauri ではファイルが唯一の正で、
// localStorage には書かない (#1042。ウィンドウ間の追随は変更通知で行う)

function loadPluginsFromStorage(): PluginMeta[] {
  return getStorageJson<PluginMeta[]>(STORAGE_KEYS.plugins, [])
}

function savePluginsToStorage(plugins: PluginMeta[]) {
  if (settingsFs.isTauri) return
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

    // Kick off file-based init (Tauri only)
    if (settingsFs.isTauri) {
      initFileStorage()
        .catch((e) => console.warn('[plugins] file storage init failed:', e))
        .finally(() => resolveReady?.())
    } else {
      plugins.value = loadPluginsFromStorage()
      initialized.value = true
      resolveReady?.()
      scheduleScopeMigration()
    }
  }

  const activePlugins = computed(() => {
    ensureLoaded()
    return plugins.value.filter((p) => p.active)
  })

  /** 初回読込 (ファイル) の完了を待つ。起動時に全プラグインを起動する側が使う */
  function whenReady(): Promise<void> {
    ensureLoaded()
    return ready
  }

  function persist(plugin?: PluginMeta) {
    if (!settingsFs.isTauri) {
      savePluginsToStorage(plugins.value)
      return
    }
    void ready
      .then(async () => {
        if (plugin) {
          // ref の深い reactivity で plugins.value の要素は proxy になるため、
          // 占有判定の「操作対象自身は占有とみなさない」参照一致が崩れない
          // よう live 要素 (proxy) を渡す
          const live =
            plugins.value.find((p) => p.installId === plugin.installId) ??
            plugin
          await pluginFiles.persistItem(live, plugins.value)
        } else {
          await pluginFiles.persistAll(plugins.value, plugins.value)
        }
      })
      .catch((e) => console.warn('[plugins] failed to persist to files:', e))
  }

  /** Load plugins from files. Files are source of truth. */
  async function initFileStorage(): Promise<void> {
    const { items: filePlugins, outdated } = await pluginFiles.loadAll()

    // 初期化中にメモリ追加された plugin は残す (各自の persist が ready 後に
    // ファイル化する)
    const fileIds = new Set(filePlugins.map((p) => p.installId))
    const memoryOnly = plugins.value.filter((p) => !fileIds.has(p.installId))

    if (filePlugins.length > 0) {
      plugins.value = [...filePlugins, ...memoryOnly]
    }

    // マイグレーション (#913) はメインウィンドウのみが実行する。冪等
    if (settingsFs.isMainDeckWindow()) {
      // 規約外名の copy-adopt 正規化
      await pluginFiles.migrateItems(plugins.value)
      // on-disk の揃え (#1202 段階 0): createdAt / updatedAt の無い旧ファイルを
      // 読込時に埋めた値で書き戻す。一度きり (次回は outdated に入らない)
      for (const p of outdated) {
        await pluginFiles
          .persistItem(p, plugins.value)
          .catch((e) =>
            console.warn('[plugins] failed to align on-disk format:', e),
          )
      }
      // 履歴 sweep: 主ファイルと対応の取れない .history.json5 を削除
      await pluginFiles
        .sweepHistory()
        .catch((e) => console.warn('[plugins] history sweep failed:', e))
    }

    initialized.value = true

    // 同梱をやめて MisStore 配布に移したプラグインの移行 (#746)
    await migrateStoreMovedBuiltIns()

    // レガシー紐付けのスコープ移行 (#771)。files が source of truth に
    // なった後で走らせる。
    scheduleScopeMigration()
  }

  /**
   * 手元に残っている旧同梱プラグインを MisStore 配布版相当へ変換する (#746)。
   * 削除ではなく変換なので、ソースを書き換えていても壊れない。
   */
  async function migrateStoreMovedBuiltIns(): Promise<void> {
    const { migrated, changed, changedPlugins } = planStoreMovedPluginMigration(
      plugins.value,
    )
    if (!changed) return
    plugins.value = migrated
    savePluginsToStorage(plugins.value)
    if (settingsFs.isTauri) {
      await pluginFiles
        .persistAll(changedPlugins, plugins.value)
        .catch((e) =>
          console.warn('[plugins] failed to persist store-moved plugins:', e),
        )
    }
  }

  function addPlugin(plugin: PluginMeta) {
    ensureLoaded()
    const now = Date.now()
    plugin.createdAt ??= now
    plugin.updatedAt ??= now
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
    // Clean up plugin localStorage entries
    // undo で戻せるよう消す前にスナップショットを取る (widgets と同型)
    const storagePrefix = STORAGE_KEYS.aiscriptPlugin(installId)
    const savedStorage = getStorageByPrefix(storagePrefix)
    removeStorageByPrefix(storagePrefix)
    plugins.value = plugins.value.filter((p) => p.installId !== installId)
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
          .catch((e) =>
            console.warn('[plugins] failed to restore plugin files:', e),
          )
      }
    }
  }

  /**
   * 読取専用 (ソース欠損) の個体は変更を拒否する (#1111)。保存できず端末
   * ローカルにだけ載って次回起動で巻き戻るため、写しに書く前に抜ける
   */
  function rejectIfReadOnly(plugin: PluginMeta | undefined): boolean {
    if (!plugin?.readOnly) return false
    console.warn('[plugins] read-only plugin — change rejected')
    return true
  }

  /** 全体スコープに参加させる。全アカウントカラムからのインストール/追加用。 */
  function linkGlobalScope(installId: string): boolean {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return false
    if (rejectIfReadOnly(plugin)) return false
    if (plugin.global) return true
    plugin.global = true
    plugin.updatedAt = Date.now()
    persist(plugin)
    return true
  }

  /** 全体スコープから外す。本体はライブラリに残る (widgets の detach と同型)。 */
  function unlinkGlobalScope(installId: string): boolean {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return false
    if (rejectIfReadOnly(plugin)) return false
    if (!plugin.global) return true
    plugin.global = undefined
    plugin.updatedAt = Date.now()
    persist(plugin)
    return true
  }

  /** アカウント別スコープ (`accountScopeKey`) に参加させる (union)。 */
  function linkAccountScope(installId: string, scopeKey: string): boolean {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return false
    if (rejectIfReadOnly(plugin)) return false
    const existing = plugin.installedFor ?? []
    if (existing.includes(scopeKey)) return true
    plugin.installedFor = [...existing, scopeKey]
    plugin.updatedAt = Date.now()
    persist(plugin)
    return true
  }

  /** アカウント別スコープから外す。本体はライブラリに残る。 */
  function unlinkAccountScope(installId: string, scopeKey: string): boolean {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return false
    if (rejectIfReadOnly(plugin)) return false
    if (!plugin.installedFor) return true
    const remaining = plugin.installedFor.filter((k) => k !== scopeKey)
    plugin.installedFor = remaining.length > 0 ? remaining : undefined
    plugin.updatedAt = Date.now()
    persist(plugin)
    return true
  }

  /** scope に応じて振り分ける。false = 読取専用で拒否 (#1111)。 */
  function linkScope(installId: string, scope: PluginScope): boolean {
    return scope.kind === 'global'
      ? linkGlobalScope(installId)
      : linkAccountScope(installId, scope.key)
  }

  /** scope に応じて振り分ける。false = 読取専用で拒否 (#1111)。 */
  function unlinkScope(installId: string, scope: PluginScope): boolean {
    return scope.kind === 'global'
      ? unlinkGlobalScope(installId)
      : unlinkAccountScope(installId, scope.key)
  }

  /**
   * アカウント削除時に、そのアカウントのスコープ参加をすべて外す (#1114)。
   * 「データを削除」はウィジェット (#1061) と同じ明示的な破棄なので、
   * ここで掃除する (ログアウトでは残す)。本体はライブラリに残り、ピッカーから
   * 再追加できる。全体スコープと他アカウントの参加には触れない
   */
  function purgeAccount(scopeKey: string): void {
    ensureLoaded()
    for (const plugin of plugins.value) {
      if (!plugin.installedFor?.includes(scopeKey)) continue
      unlinkAccountScope(plugin.installId, scopeKey)
    }
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

  /** false = 読取専用で拒否 (#1111)。 */
  function setActive(installId: string, active: boolean): boolean {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return false
    if (rejectIfReadOnly(plugin)) return false
    plugin.active = active
    plugin.updatedAt = Date.now()
    persist(plugin)
    return true
  }

  /** false = 読取専用で拒否 (#1111)。 */
  function updateConfigData(
    installId: string,
    data: Record<string, unknown>,
  ): boolean {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return false
    if (rejectIfReadOnly(plugin)) return false
    plugin.configData = data
    plugin.updatedAt = Date.now()
    persist(plugin)
    return true
  }

  /** false = 読取専用で拒否 (#913 / #1111)。 */
  function updateSrc(
    installId: string,
    src: string,
    attribution?: EditAttribution,
  ): boolean {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return false
    if (rejectIfReadOnly(plugin)) return false
    // 編集前 src を history sidecar に push (fire-and-forget)。
    // 履歴キーは対応表の fileBase (未割当 = ファイル未作成なら履歴も無し)。
    // 内容が同じ保存では積まない — エディタのデバウンス自動保存でリングを
    // 使い潰し、意味のある編集前の状態が押し出されるのを防ぐ
    if (plugin.fileBase && plugin.src !== src) {
      pushSnapshot(
        'plugin',
        plugin.fileBase,
        {
          src: plugin.src,
          name: plugin.name,
          version: plugin.version,
          permissions: plugin.permissions,
          active: plugin.active,
        },
        attribution,
      ).catch((e) => console.warn('[plugins] history push failed:', e))
    }
    plugin.src = src
    plugin.updatedAt = Date.now()
    persist(plugin)
    return true
  }

  /**
   * ストア再インストール (#913): 本体 (src) とストア由来メタを上書き更新する。
   * ローカル値 (name の改名・active・スコープ・configData の設定値) は維持し、
   * 新しい config キーのみデフォルト値を補完する。ソース欠損の readOnly 個体は
   * 検証済み配布ソースで復旧する (persist 抑止を解除)。
   */
  function applyStoreUpdate(
    installId: string,
    patch: {
      src: string
      version: string
      author?: string
      description?: string
      permissions?: string[]
      config?: Record<string, PluginConfigDef>
      iconUrl?: string
      storeSha512: string
      storeVersion: string
    },
  ): void {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return
    // 編集前 src を history sidecar に push (updateSrc と同じ undo リング)
    if (plugin.fileBase && !plugin.readOnly) {
      pushSnapshot('plugin', plugin.fileBase, {
        src: plugin.src,
        name: plugin.name,
        version: plugin.version,
        permissions: plugin.permissions,
        active: plugin.active,
      }).catch((e) => console.warn('[plugins] history push failed:', e))
    }
    plugin.src = patch.src
    plugin.version = patch.version
    plugin.author = patch.author
    plugin.description = patch.description
    plugin.permissions = patch.permissions
    plugin.config = patch.config
    plugin.iconUrl = patch.iconUrl
    plugin.storeSha512 = patch.storeSha512
    plugin.storeVersion = patch.storeVersion
    if (patch.config) {
      for (const [key, def] of Object.entries(patch.config)) {
        if (!(key in plugin.configData)) plugin.configData[key] = def.default
      }
    }
    plugin.readOnly = undefined
    plugin.updatedAt = Date.now()
    persist(plugin)
  }

  /**
   * 更新検知の基準記録 (#1040)。storeSha512 未記録のストア由来プラグインへ
   * registry 現行値を無通知で記録する。本体・ローカル値には触れない
   * (履歴 push もしない)。
   */
  function recordStoreBaseline(
    installId: string,
    patch: { storeSha512: string; storeVersion: string },
  ): void {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return
    plugin.storeSha512 = patch.storeSha512
    plugin.storeVersion = patch.storeVersion
    persist(plugin)
  }

  /** false = 読取専用で拒否 (#1111)。 */
  function renamePlugin(installId: string, newName: string): boolean {
    ensureLoaded()
    const plugin = plugins.value.find((p) => p.installId === installId)
    if (!plugin) return false
    if (rejectIfReadOnly(plugin)) return false

    plugin.name = newName
    plugin.updatedAt = Date.now()
    savePluginsToStorage(plugins.value)
    if (!settingsFs.isTauri) return true
    // ファイルは rename で追随させる (ID 不変・旧削除 + 新書込の並行発火禁止)。
    // rename の完了を待ってから保存する
    void ready
      .then(async () => {
        await pluginFiles.renameItemFiles(plugin, plugins.value)
        await pluginFiles.persistItem(plugin, plugins.value)
      })
      .catch((e) => console.warn('[plugins] failed to rename plugin files:', e))
    return true
  }

  function getPlugin(installId: string): PluginMeta | undefined {
    ensureLoaded()
    return plugins.value.find((p) => p.installId === installId)
  }

  function isDuplicate(name: string): boolean {
    ensureLoaded()
    return plugins.value.some((p) => p.name === name)
  }

  // 別の書き手 (notecore の plugins.* / 他のウィンドウ, #1133 / #1042) がプラグインの
  // ファイルを書いた → その個体だけ写しを揃え、有効 / ソース変更なら起動し直し、
  // 無効化 / 削除なら止める (UI のトグル・削除と同じ後処理)。src だけの通知は
  // meta の通知が続くので見ない。plugin-api は本 store を import するので遅延参照
  registerSettingsFileHandler('plugins', async (change) => {
    if (!change.name.endsWith(META_SUFFIX)) return
    ensureLoaded()
    await ready
    const fileBase = change.name.slice(0, -META_SUFFIX.length)
    const { abortPlugin, launchPlugin } = await import('@/aiscript/plugin-api')
    if (change.op === 'delete') {
      const removed = plugins.value.find((p) => p.fileBase === fileBase)
      if (!removed) return
      abortPlugin(removed.installId)
      removeStorageByPrefix(STORAGE_KEYS.aiscriptPlugin(removed.installId))
      plugins.value = plugins.value.filter((p) => p !== removed)
      return
    }
    let item: PluginMeta | undefined
    try {
      item = await pluginFiles.loadOne(change.name)
    } catch (e) {
      console.warn(`[plugins] reload ${change.name} failed:`, e)
      return
    }
    if (!item) return
    const next = item
    const prev = plugins.value.find(
      (p) => p.installId === next.installId || p.fileBase === fileBase,
    )
    plugins.value = prev
      ? plugins.value.map((p) => (p === prev ? next : p))
      : [...plugins.value, next]
    // 起動し直す条件: 有効化 / ソース / 設定値 / 権限 (ストア更新で変わる) の変化
    const changed =
      !prev?.active ||
      prev.src !== next.src ||
      JSON.stringify(prev.configData) !== JSON.stringify(next.configData) ||
      JSON.stringify(prev.permissions ?? []) !==
        JSON.stringify(next.permissions ?? [])
    if (next.active && changed) {
      await launchPlugin(next)
    } else if (!next.active && prev?.active) {
      abortPlugin(next.installId)
    }
  })

  return {
    plugins,
    whenReady,
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
    purgeAccount,
    migrateScopes,
    applyStoreUpdate,
    recordStoreBaseline,
    renamePlugin,
    setActive,
    updateConfigData,
    updateSrc,
    getPlugin,
    isDuplicate,
  }
})

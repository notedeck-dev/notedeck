import { defineStore } from 'pinia'
import { watch } from 'vue'
import type { DistributableStoreOrigin } from '@/services/distributable'
import {
  type PluginConfigDef,
  type PluginItem,
  pluginCodec,
} from '@/services/distributableCodecs/pluginCodec'
import {
  sidecarCollectionFor,
  sidecarFileBaseOf,
} from '@/services/distributableCodecs/sidecar'
import { migrateStoreMovedPlugins } from '@/services/storeMovedPlugins'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
  createDistributableStore,
  type NewDistributable,
} from '@/stores/distributableStore'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageByPrefix,
  removeStorageByPrefix,
  STORAGE_KEYS,
  setStorageString,
} from '@/utils/storage'
import { notifyWarningToast } from '@/utils/toastNotify'

/**
 * プラグイン本体のプール。
 *
 * - 個体は envelope (`PluginItem`、#1202 段階 1)。本文 (`content`) は AiScript
 *   ソース、`extra.active` が本体の有効、`extra.configData` が設定値 (ローカル)
 * - スコープはプール制 (#771): 全体 (`global`) / アカウント別 (`installedFor`)。
 *   どちらにも参加していない本体はライブラリにだけある
 * - 保存は sidecar 形式 (`plugins/<name>.is` + `.meta.json5`)。projection は
 *   `pluginCodec`
 * - **起動 / 停止はこの store の hook に一本化する**。有効の切替 / 本文の更新 /
 *   ストア更新 / 設定値の更新 / 削除 (と undo) / 別の書き手の変更通知のどれも、
 *   写しが変わった後に実行基盤 (`aiscript/plugin-api`) を状態に合わせる。
 *   呼び出し側 (管理カラム / 編集ウィンドウ / capability / misstore) は store の
 *   API だけを呼ぶ
 */

export type {
  PluginConfigDef,
  PluginItem,
} from '@/services/distributableCodecs/pluginCodec'

const pluginFiles = sidecarCollectionFor(pluginCodec, {
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
})

export function generatePluginId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 実行基盤。plugin-api は本 store を import する (handler のスコープ評価) ので、
 * こちらからは遅延参照して静的な循環を作らない
 */
const runtime = () => import('@/aiscript/plugin-api')

/** 配布ソースから決まる値 (ヘッダ由来 + ストア 3 点)。ローカル値は含まない */
export interface PluginStorePatch {
  content: string
  version: string
  author?: string
  description?: string
  permissions?: string[]
  config?: Record<string, PluginConfigDef>
  iconUrl?: string
  store: DistributableStoreOrigin
}

/** 安定キーは host:userId 形式で必ず ':' を含む。旧 UUID には含まれない */
const isScopeKey = (v: string) => v.includes(':')

export const usePluginsStore = defineStore('plugins', () => {
  /**
   * 実行基盤を写しの状態に合わせる: 有効なら (再) 起動、無効なら停止。
   * launchPlugin は既存インスタンスを止めてから起動するので、本文 / 設定値の
   * 変更もこれで新しい値に載せ替わる
   */
  function syncRuntime(item: PluginItem): void {
    void runtime().then(({ launchPlugin, abortPlugin }) =>
      item.extra.active ? launchPlugin(item) : abortPlugin(item.id),
    )
  }

  const base = createDistributableStore<string, PluginItem>({
    logTag: 'plugins',
    codec: pluginCodec,
    files: pluginFiles,
    settingsScope: 'plugins',
    fileBaseOf: sidecarFileBaseOf,
    browserStorageKey: STORAGE_KEYS.plugins,
    generateId: generatePluginId,
    // 履歴の形は `plugins.revert` (notecore) とエディタの履歴窓が読むので
    // キー名は on-disk の互換を保つ
    history: {
      kind: 'plugin',
      snapshot: (p) => ({
        src: p.content,
        name: p.name,
        version: p.extra.version,
        permissions: p.extra.permissions,
        active: p.extra.active,
      }),
    },
    // アカウント削除時は紐付けを外すだけ。本体はライブラリに残る (#1114)
    purgeAccount: 'unlink',
    hooks: {
      // 同梱をやめて MisStore 配布に移したプラグインの移行 (#746)
      migrate: migrateStoreMovedPlugins,
      // 本文が変わったら有効なものは新しいソースで起動し直す (#744)。自分の
      // 保存も別の書き手 (notecore の plugins.* / 他のウィンドウ) も同じ
      afterContentChange: (p) => syncRuntime(p),
      afterEnabledChange: syncRuntime,
      // Mk:save の領域は削除で消し、undo で戻す。戻した本体が有効なら起動し直す
      snapshotForUndo: (p) =>
        getStorageByPrefix(STORAGE_KEYS.aiscriptPlugin(p.id)),
      restoreFromUndo: (p, snapshot) => {
        for (const [key, value] of Object.entries(
          snapshot as Record<string, string>,
        )) {
          setStorageString(key, value)
        }
        syncRuntime(p)
      },
      afterRemove: (p) => {
        void runtime().then(({ abortPlugin }) => abortPlugin(p.id))
        removeStorageByPrefix(STORAGE_KEYS.aiscriptPlugin(p.id))
      },
    },
  })

  /**
   * レガシー紐付けの移行 (#771)。アカウント一覧が要るので accounts ロード後に
   * 1 回だけ走る。`installedFor` の旧 UUID (内部 ID) を現行アカウントの安定
   * キーへ置き換え、現存しない UUID は捨てる (再ログインで変わった痕跡)。置換の
   * 結果が全現行アカウントをカバーするなら (旧 全アカウントカラムの
   * スナップショット) 全体スコープへ昇格する。安定キーだけの個体には触れない
   */
  let scopesMigrated = false
  async function migrateScopes(): Promise<void> {
    const accountsStore = useAccountsStore()
    if (!accountsStore.isLoaded || scopesMigrated) return
    scopesMigrated = true
    await base.whenReady()
    const uuidToKey = new Map(
      accountsStore.accounts.map((a) => [a.id, accountScopeKey(a)]),
    )
    const allKeys = [...uuidToKey.values()]
    for (const p of [...base.items.value]) {
      if (p.scope.kind !== 'shared' || p.scope.global) continue
      const list = p.scope.installedFor
      if (list.length === 0 || list.every(isScopeKey)) continue
      const mapped = [
        ...new Set(list.map((v) => (isScopeKey(v) ? v : uuidToKey.get(v)))),
      ].filter((v): v is string => !!v)
      for (const v of list) {
        if (!isScopeKey(v)) await base.unlink(p.id, { kind: 'account', key: v })
      }
      const coversAll =
        allKeys.length > 0 && allKeys.every((k) => mapped.includes(k))
      if (coversAll) {
        for (const k of mapped) {
          await base.unlink(p.id, { kind: 'account', key: k })
        }
        await base.link(p.id, { kind: 'global' })
      } else {
        for (const k of mapped)
          await base.link(p.id, { kind: 'account', key: k })
      }
    }
  }
  let scopeMigrationScheduled = false
  function scheduleScopeMigration(): void {
    if (scopeMigrationScheduled) return
    scopeMigrationScheduled = true
    const accountsStore = useAccountsStore()
    if (accountsStore.isLoaded) {
      void migrateScopes()
      return
    }
    const stop = watch(
      () => accountsStore.isLoaded,
      (loaded) => {
        if (!loaded) return
        stop()
        void migrateScopes()
      },
    )
  }

  function ensureLoaded(): void {
    base.ensureLoaded()
    scheduleScopeMigration()
  }

  /** 初回読込の完了を待つ。起動時に全プラグインを起動する側が使う */
  function whenReady(): Promise<void> {
    ensureLoaded()
    return base.whenReady()
  }

  /** 追加。有効なら起動する (add は共通層の hook を通らない) */
  async function add(input: NewDistributable<PluginItem>): Promise<PluginItem> {
    ensureLoaded()
    const item = await base.add(input)
    if (item.extra.active) syncRuntime(item)
    return item
  }

  /**
   * 設定値の更新。有効なら新しい値で起動し直す (`Plugin:config` は起動時に
   * 組まれる)。false = 読取専用で拒否 (#1111)
   */
  async function setConfigData(
    id: string,
    configData: Record<string, unknown>,
  ): Promise<boolean> {
    if (!(await base.updateExtra(id, { configData }))) return false
    const item = base.get(id)
    if (item) syncRuntime(item)
    return true
  }

  /**
   * ストア再インストール / 更新 (#913): 本文とストア由来 (ヘッダ由来の版 /
   * 権限 / 設定定義を含む) を上書きする。ローカル値 (改名した name / 有効 /
   * 参加先 / 設定値) は維持し、新しい設定キーだけ default を補う
   */
  async function applyStoreUpdate(
    id: string,
    patch: PluginStorePatch,
  ): Promise<boolean> {
    const prev = base.get(id)
    if (!prev) return false
    const configData = { ...prev.extra.configData }
    for (const [key, def] of Object.entries(patch.config ?? {})) {
      if (!(key in configData)) configData[key] = def.default
    }
    return base.applyStoreUpdate(id, {
      content: patch.content,
      description: patch.description,
      iconUrl: patch.iconUrl,
      store: patch.store,
      extra: {
        ...prev.extra,
        version: patch.version,
        author: patch.author,
        permissions: patch.permissions,
        config: patch.config,
        configData,
      },
    })
  }

  return {
    ...base,
    ensureLoaded,
    whenReady,
    add,
    setConfigData,
    applyStoreUpdate,
  }
})

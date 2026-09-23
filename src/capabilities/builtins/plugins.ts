import {
  abortPlugin,
  launchPlugin,
  parsePluginMeta,
} from '@/aiscript/plugin-api'
import type { Command } from '@/commands/registry'
import { useMisStoreStore } from '@/stores/misstore'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'
import { implement } from '../declare'
import { editAttribution } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'
import { preflightValidateSrc } from './aiscript'

interface PluginSnapshot {
  src: string
  name?: string
  version?: string
  permissions?: string[]
  active?: boolean
}

/**
 * Plugin 系 capability — AI が AiScript プラグインを動的に作成・編集・有効化・
 * 削除できる (= 「自己拡張する IDE」PR-D、memory:
 * project_self_extending_ide_roadmap.md)。skills / widgets / themes と同様に
 * 全 write capability を `aiTool: true` で開放し、各 `requiresConfirmation` の
 * 関数版で MisStore カード風の install preview を出してユーザー承認を取る。
 *
 * 安全策:
 * - `create` は常に `active: false` で作成 (widget の `autoRun: false` default
 *   と同じ思想)。handler 起動は `setActive(true)` での明示承認 (= 二重承認)。
 * - `setActive(true)` (有効化) は confirm で permissions を表示。
 *   `setActive(false)` (無効化) は handler 停止のみで confirm スキップ。
 * - `delete` / `revert` は確認ダイアログで対象情報 / 戻し先 snapshot を表示。
 *
 * 読取系 (list / read / history) も `aiTool: true`。
 */

export const pluginsListCapability = implement('plugins.list', {
  execute: () => {
    const store = usePluginsStore()
    return store.plugins.map((p) => ({
      installId: p.installId,
      name: p.name,
      version: p.version,
      author: p.author ?? null,
      description: p.description ?? null,
      active: p.active,
      permissions: p.permissions ?? [],
      storeId: p.storeId ?? null,
    }))
  },
})

export const pluginsReadCapability = implement('plugins.read', {
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('plugins.read: installId is required')
    const store = usePluginsStore()
    const plugin = store.getPlugin(installId)
    if (!plugin) {
      throw new Error(`plugins.read: plugin "${installId}" not found`)
    }
    return {
      installId: plugin.installId,
      name: plugin.name,
      version: plugin.version,
      src: plugin.src,
      active: plugin.active,
      permissions: plugin.permissions ?? [],
      configData: plugin.configData,
    }
  },
})

export const pluginsCreateCapability = implement('plugins.create', {
  preflight: (params) => preflightValidateSrc(params, 'plugin'),
  requiresConfirmation: (params) => ({
    title: 'プラグインをインストール',
    message:
      'AI が生成したプラグインをインストールします。作成直後は無効化された' +
      '状態なので、有効化はプラグインカラムから手動で行ってください。',
    installPreview: {
      kind: 'plugin',
      name: typeof params?.name === 'string' ? params.name : '',
      version:
        typeof params?.version === 'string' && params.version.length > 0
          ? params.version
          : '1.0.0',
      author: typeof params?.author === 'string' ? params.author : undefined,
      description:
        typeof params?.description === 'string'
          ? params.description
          : undefined,
      permissions: isStringArray(params?.permissions) ? params.permissions : [],
    },
    code: typeof params?.src === 'string' ? params.src : '',
    codeLanguage: 'is',
    okLabel: 'インストール',
    cancelLabel: 'やめる',
    type: 'normal',
  }),
  execute: (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    if (!name) throw new Error('plugins.create: name is required')
    if (!src) throw new Error('plugins.create: src is required')
    const version =
      typeof params?.version === 'string' && params.version.length > 0
        ? params.version
        : '1.0.0'
    const author =
      typeof params?.author === 'string' ? params.author : undefined
    const description =
      typeof params?.description === 'string' ? params.description : undefined
    const permissions = isStringArray(params?.permissions)
      ? params.permissions
      : undefined
    const installId = `nd-plugin-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
    const plugin: PluginMeta = {
      installId,
      name,
      version,
      author,
      description,
      permissions,
      configData: {},
      src,
      active: false,
      // AI 経由はカラム文脈を持たないため全体スコープで作成 (#771)
      global: true,
    }
    const store = usePluginsStore()
    store.addPlugin(plugin)
    return { installId, name, active: false }
  },
})

export const pluginsUpdateCapability = implement('plugins.update', {
  preflight: (params) => preflightValidateSrc(params, 'plugin'),
  requiresConfirmation: (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const cur = usePluginsStore().getPlugin(installId)
    if (!cur) return null
    stageEdit(ctx, cur.src, src)
    const newMeta = parsePluginMeta(src)
    return {
      title: 'プラグインを更新',
      message:
        `${cur.name} の AiScript を ${cur.src.length} → ${src.length} 文字に置換します。` +
        (cur.active
          ? 'アクティブなため、保存後すぐ新しいコードで再起動されます。'
          : ''),
      installPreview: {
        kind: 'plugin',
        name: newMeta?.name ?? cur.name,
        version: newMeta?.version ?? cur.version,
        author: newMeta?.author ?? cur.author,
        description: newMeta?.description ?? cur.description,
        permissions: newMeta?.permissions ?? cur.permissions ?? [],
      },
      diff: { old: cur.src, new: src, language: 'aiscript' },
      okLabel: '更新',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: async (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    if (!installId) throw new Error('plugins.update: installId is required')
    if (!src) throw new Error('plugins.update: src is required')
    const store = usePluginsStore()
    const cur = store.getPlugin(installId)
    if (!cur) {
      throw new Error(`plugins.update: plugin "${installId}" not found`)
    }
    const next = takeStagedEdit(ctx, 'plugins.update', cur.src, () => src)
    store.updateSrc(installId, next, editAttribution(ctx, params))
    // アクティブなら UI の保存と同様に新 src で再起動する (#744)。
    // launchPlugin は内部で既存インスタンスを abort する。
    const updated = store.getPlugin(installId)
    let relaunched = false
    if (updated?.active) {
      await launchPlugin(updated)
      relaunched = true
    }
    return { installId, length: next.length, relaunched }
  },
})

export const pluginsSetActiveCapability = implement('plugins.setActive', {
  // 有効化 (active=true) は handler が動き始める = Misskey API 介入の副作用が
  // 走り得るので permissions を見せて確認。無効化 (active=false) は handler
  // 停止 (= 安全方向への可逆動作) なので即実行で OK。
  requiresConfirmation: (params) => {
    const active = params?.active === true
    if (!active) return null
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const cur = usePluginsStore().getPlugin(installId)
    if (!cur) return null
    return {
      title: 'プラグインを有効化',
      message:
        `${cur.name} を有効化します。handler が起動し、` +
        '以下の permissions の操作が走り得ます。',
      installPreview: {
        kind: 'plugin',
        name: cur.name,
        version: cur.version,
        author: cur.author,
        description: cur.description,
        permissions: cur.permissions ?? [],
      },
      okLabel: '有効化',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: async (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) {
      throw new Error('plugins.setActive: installId is required')
    }
    const active = params?.active === true
    const store = usePluginsStore()
    if (!store.getPlugin(installId)) {
      throw new Error(`plugins.setActive: plugin "${installId}" not found`)
    }
    store.setActive(installId, active)
    // フラグ更新だけでは handler は起動しない (UI トグルと同じく launch/abort が必要)
    const updated = store.getPlugin(installId)
    if (active && updated) {
      await launchPlugin(updated)
    } else {
      abortPlugin(installId)
    }
    return { installId, active }
  },
})

export const pluginsDeleteCapability = implement('plugins.delete', {
  requiresConfirmation: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const cur = usePluginsStore().getPlugin(installId)
    if (!cur) return null
    return {
      title: 'プラグインを削除',
      message:
        `${cur.name} を削除します。AiScript ソース・メタ・` +
        'Mk:save 領域がすべて消えます (= 不可逆)。',
      installPreview: {
        kind: 'plugin',
        name: cur.name,
        version: cur.version,
        author: cur.author,
        description: cur.description,
        permissions: cur.permissions ?? [],
      },
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('plugins.delete: installId is required')
    const store = usePluginsStore()
    const existed = !!store.getPlugin(installId)
    store.removePlugin(installId)
    return { installId, removed: existed }
  },
})

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

export const pluginsHistoryCapability = implement('plugins.history', {
  execute: async (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('plugins.history: installId is required')
    const store = usePluginsStore()
    const plugin = store.getPlugin(installId)
    if (!plugin) {
      throw new Error(`plugins.history: plugin "${installId}" not found`)
    }
    const basename = plugin.fileBase ?? (plugin.name || plugin.installId)
    return await listSnapshots<PluginSnapshot>('plugin', basename)
  },
})

export const pluginsRevertCapability = implement('plugins.revert', {
  requiresConfirmation: async (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    const cur = usePluginsStore().getPlugin(installId)
    if (!cur || index < 0) return null
    const basename = cur.fileBase ?? (cur.name || cur.installId)
    const entry = await getSnapshotAt<PluginSnapshot>('plugin', basename, index)
    if (!entry) return null
    const snap = entry.snapshot
    const next = stageEdit(ctx, cur.src, snap.src)
    return {
      title: 'プラグインを過去の状態に戻す',
      message:
        `${cur.name} を編集履歴 #${index} (${new Date(entry.at).toLocaleString()}) ` +
        'の状態に戻します。現在の AiScript ソースは上書きされます。',
      installPreview: {
        kind: 'plugin',
        name: snap.name ?? cur.name,
        version: snap.version ?? cur.version,
        author: cur.author,
        description: cur.description,
        permissions: snap.permissions ?? cur.permissions ?? [],
      },
      diff: { old: cur.src, new: next, language: 'aiscript' },
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  execute: async (params, ctx) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    if (!installId) throw new Error('plugins.revert: installId is required')
    if (index < 0) throw new Error('plugins.revert: index must be >= 0')
    const store = usePluginsStore()
    const plugin = store.getPlugin(installId)
    if (!plugin) {
      throw new Error(`plugins.revert: plugin "${installId}" not found`)
    }
    const basename = plugin.fileBase ?? (plugin.name || plugin.installId)
    const entry = await getSnapshotAt<PluginSnapshot>('plugin', basename, index)
    if (!entry) {
      throw new Error(`plugins.revert: no snapshot at index ${index}`)
    }
    const next = takeStagedEdit(
      ctx,
      'plugins.revert',
      plugin.src,
      () => entry.snapshot.src,
    )
    store.updateSrc(installId, next, editAttribution(ctx, params))
    return { installId, reverted: true, at: entry.at }
  },
})

/**
 * `plugins.install` — MisStore (store.notedeck.io) から既製プラグインを取得して
 * plugins store に追加する。AI が「○○の機能ない？」のように推薦から install
 * まで一気通貫で実行できるようにするためのラッパ。
 *
 * 内部実装は `useMisStoreStore.installPlugin(entry, scope)` を呼ぶだけ。
 * sha512 検証・parsePluginMeta・既存 storeId へのスコープ追加は misstore
 * store 側で実装済 (= 同 storeId のプラグインがあれば再インストールせず
 * scope 参照を追加するだけ)。AI 経由はカラム文脈を持たないため全体スコープ
 * (全アカウント対象、後から追加した分も含む #771) で入れる。インストール後は
 * active=true で自動起動される (misstore.ts installPlugin の挙動)。
 */
export const pluginsInstallCapability = implement('plugins.install', {
  requiresConfirmation: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) return null
    const misStore = useMisStoreStore()
    await misStore.fetchPlugins()
    const entry = misStore.plugins.find((p) => p.id === id)
    if (!entry) return null
    return {
      title: 'MisStore からプラグインを入れる',
      message:
        `${entry.name} (v${entry.version} / by ${entry.author}) を MisStore から取得します。` +
        ' インストール直後に自動で active=true で起動されます。',
      installPreview: {
        kind: 'plugin',
        name: entry.name,
        version: entry.version,
        author: entry.author,
        description: entry.description,
      },
      code: entry.description,
      codeLanguage: 'plaintext',
      okLabel: 'インストール',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('plugins.install: id is required')
    const misStore = useMisStoreStore()
    await misStore.fetchPlugins()
    const entry = misStore.plugins.find((p) => p.id === id)
    if (!entry) {
      throw new Error(
        `plugins.install: plugin "${id}" not found in MisStore (try misstore.search first)`,
      )
    }
    await misStore.installPlugin(entry, { kind: 'global' })
    return { id: entry.id, name: entry.name, installed: true }
  },
})

/**
 * `plugins.uninstall` — インストール済みプラグインを完全削除する。
 * `plugins.delete` と同等動作だが、命名を MisStore install/uninstall 対称形に
 * 揃え、storeId からも引けるエイリアス。AI が「MisStore で入れた○○外して」
 * と発話したとき id ベースで消せるよう、両方を受け付ける。
 */
export const pluginsUninstallCapability = implement('plugins.uninstall', {
  requiresConfirmation: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const storeId = typeof params?.storeId === 'string' ? params.storeId : ''
    const pluginsStore = usePluginsStore()
    const cur = installId
      ? pluginsStore.getPlugin(installId)
      : pluginsStore.plugins.find((p) => p.storeId === storeId)
    if (!cur) return null
    return {
      title: 'プラグインを削除',
      message:
        `${cur.name} を削除します。AiScript ソース・メタ・Mk:save 領域が` +
        'すべて消えます (= 不可逆)。',
      installPreview: {
        kind: 'plugin',
        name: cur.name,
        version: cur.version,
        author: cur.author,
        description: cur.description,
        permissions: cur.permissions ?? [],
      },
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const storeId = typeof params?.storeId === 'string' ? params.storeId : ''
    if (!installId && !storeId) {
      throw new Error('plugins.uninstall: installId or storeId is required')
    }
    const store = usePluginsStore()
    const plugin = installId
      ? store.getPlugin(installId)
      : store.plugins.find((p) => p.storeId === storeId)
    if (!plugin) {
      throw new Error(
        `plugins.uninstall: plugin not found (installId="${installId}" storeId="${storeId}")`,
      )
    }
    store.removePlugin(plugin.installId)
    return { installId: plugin.installId, removed: true }
  },
})

export const PLUGINS_BUILTIN_CAPABILITIES: readonly Command[] = [
  pluginsListCapability,
  pluginsReadCapability,
  pluginsCreateCapability,
  pluginsUpdateCapability,
  pluginsSetActiveCapability,
  pluginsDeleteCapability,
  pluginsInstallCapability,
  pluginsUninstallCapability,
  pluginsHistoryCapability,
  pluginsRevertCapability,
]

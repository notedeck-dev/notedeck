import { parsePluginMeta } from '@/aiscript/plugin-api'
import type { Command } from '@/commands/registry'
import { useAccountsStore } from '@/stores/accounts'
import { useMisStoreStore } from '@/stores/misstore'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'
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

export const pluginsListCapability: Command = {
  id: 'plugins.list',
  label: 'プラグイン一覧',
  icon: 'ti-puzzle',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.read'],
  signature: {
    description:
      'インストール済みプラグインのメタデータ一覧を返す。' +
      ' AiScript ソースは含まれない (= plugins.read で個別取得)。',
    params: {},
    returns: {
      type: 'array',
      description:
        '{ installId, name, version, author?, description?, active, permissions?, storeId? } の配列',
    },
    cheap: true,
  },
  visible: false,
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
}

export const pluginsReadCapability: Command = {
  id: 'plugins.read',
  label: 'プラグインの AiScript を読む',
  icon: 'ti-code',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.read'],
  signature: {
    description: '指定 installId のプラグインの AiScript ソースを返す。',
    params: {
      installId: {
        type: 'string',
        description: '対象プラグインの installId (plugins.list で取得)',
      },
    },
    returns: {
      type: 'object',
      description:
        '{ installId, name, version, src, active, permissions, configData }',
    },
    cheap: true,
  },
  visible: false,
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
}

export const pluginsCreateCapability: Command = {
  id: 'plugins.create',
  label: 'プラグインを作成',
  icon: 'ti-plus',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.write'],
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
  signature: {
    description:
      'AiScript ソースから新規プラグインを作成する。必ず `active: false`' +
      ' (= 無効化) で作成され、handler は走らない。有効化は plugins.setActive' +
      ' で別途ユーザー UI から行う (= AI が連鎖的に handler を走らせるのを防ぐ' +
      ' 二重承認境界)。permissions は Misskey 互換キー (read:account, write:notes 等)。',
    params: {
      name: { type: 'string', description: 'プラグイン名 (UI 表示用)' },
      src: { type: 'string', description: 'AiScript ソースコード' },
      version: {
        type: 'string',
        description: 'バージョン文字列 (default "1.0.0")',
        optional: true,
      },
      author: { type: 'string', description: '作者表記', optional: true },
      description: { type: 'string', description: '概要', optional: true },
      permissions: {
        type: 'array',
        description: 'プラグインが要求する permission の配列 (Misskey 互換)',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ installId, name, active: false }',
    },
  },
  visible: false,
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
    }
    const store = usePluginsStore()
    store.addPlugin(plugin)
    return { installId, name, active: false }
  },
}

export const pluginsUpdateCapability: Command = {
  id: 'plugins.update',
  label: 'プラグインの AiScript を更新',
  icon: 'ti-edit',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.write'],
  preflight: (params) => preflightValidateSrc(params, 'plugin'),
  requiresConfirmation: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const cur = usePluginsStore().getPlugin(installId)
    if (!cur) return null
    const newMeta = parsePluginMeta(src)
    return {
      title: 'プラグインを更新',
      message: `${cur.name} の AiScript を ${cur.src.length} → ${src.length} 文字に置換します。`,
      installPreview: {
        kind: 'plugin',
        name: newMeta?.name ?? cur.name,
        version: newMeta?.version ?? cur.version,
        author: newMeta?.author ?? cur.author,
        description: newMeta?.description ?? cur.description,
        permissions: newMeta?.permissions ?? cur.permissions ?? [],
      },
      code: src,
      codeLanguage: 'is',
      okLabel: '更新',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      'プラグインの AiScript ソースを全文置換する。' +
      'plugins.read で現状を取得してから差分判断する運用を推奨。',
    params: {
      installId: { type: 'string', description: '対象プラグインの installId' },
      src: { type: 'string', description: '新しい AiScript ソース全文' },
    },
    returns: {
      type: 'object',
      description: '{ installId, length: 新 src の文字数 }',
    },
  },
  visible: false,
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    if (!installId) throw new Error('plugins.update: installId is required')
    if (!src) throw new Error('plugins.update: src is required')
    const store = usePluginsStore()
    if (!store.getPlugin(installId)) {
      throw new Error(`plugins.update: plugin "${installId}" not found`)
    }
    store.updateSrc(installId, src)
    return { installId, length: src.length }
  },
}

export const pluginsSetActiveCapability: Command = {
  id: 'plugins.setActive',
  label: 'プラグインの有効/無効を切替',
  icon: 'ti-toggle-left',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.write'],
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
  signature: {
    description:
      'プラグインの active 状態を切り替える。有効化 (true) すると ' +
      'handler が起動して Misskey API 介入の副作用が走り得るので、AI が ' +
      '呼ぶときは確認ダイアログでユーザー承認を取る。無効化 (false) は ' +
      '即実行 (= 可逆な停止操作)。',
    params: {
      installId: { type: 'string', description: '対象プラグインの installId' },
      active: {
        type: 'boolean',
        description: 'true = 有効化 / false = 無効化',
      },
    },
    returns: {
      type: 'object',
      description: '{ installId, active }',
    },
  },
  visible: false,
  execute: (params) => {
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
    return { installId, active }
  },
}

export const pluginsDeleteCapability: Command = {
  id: 'plugins.delete',
  label: 'プラグインを削除',
  icon: 'ti-trash',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.write'],
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
  signature: {
    description:
      'プラグインを削除する。AiScript ソース・メタ・Mk:save 領域' +
      'すべて消える (= 不可逆)。confirm ダイアログで対象プラグインの ' +
      'name / version / permissions を表示してユーザー承認を取る。',
    params: {
      installId: { type: 'string', description: '対象プラグインの installId' },
    },
    returns: {
      type: 'object',
      description: '{ installId, removed: boolean }',
    },
  },
  visible: false,
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('plugins.delete: installId is required')
    const store = usePluginsStore()
    const existed = !!store.getPlugin(installId)
    store.removePlugin(installId)
    return { installId, removed: existed }
  },
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

export const pluginsHistoryCapability: Command = {
  id: 'plugins.history',
  label: 'プラグインの編集履歴',
  icon: 'ti-history',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.read'],
  signature: {
    description:
      '指定 installId のプラグインの編集前 snapshot 一覧 (新しい順、最大 10 件) を返す。',
    params: {
      installId: { type: 'string', description: '対象プラグインの installId' },
    },
    returns: {
      type: 'array',
      description: '編集前 snapshot の配列 (新しい順)',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('plugins.history: installId is required')
    const store = usePluginsStore()
    const plugin = store.getPlugin(installId)
    if (!plugin) {
      throw new Error(`plugins.history: plugin "${installId}" not found`)
    }
    const basename = plugin.name || plugin.installId
    return await listSnapshots<PluginSnapshot>('plugin', basename)
  },
}

export const pluginsRevertCapability: Command = {
  id: 'plugins.revert',
  label: 'プラグインを過去の状態に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.write'],
  requiresConfirmation: async (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    const cur = usePluginsStore().getPlugin(installId)
    if (!cur || index < 0) return null
    const basename = cur.name || cur.installId
    const entry = await getSnapshotAt<PluginSnapshot>('plugin', basename, index)
    if (!entry) return null
    const snap = entry.snapshot
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
      code: snap.src,
      codeLanguage: 'is',
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      'プラグイン src を編集履歴の index 番目に戻す。confirm ダイアログで ' +
      '戻し先 snapshot の name / version / permissions / AiScript ソースを ' +
      '表示してユーザー承認を取る。',
    params: {
      installId: { type: 'string', description: '対象プラグインの installId' },
      index: { type: 'number', description: 'snapshot index (0 = 最新)' },
    },
    returns: {
      type: 'object',
      description: '{ installId, reverted: boolean, at: number }',
    },
  },
  visible: false,
  execute: async (params) => {
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
    const basename = plugin.name || plugin.installId
    const entry = await getSnapshotAt<PluginSnapshot>('plugin', basename, index)
    if (!entry) {
      throw new Error(`plugins.revert: no snapshot at index ${index}`)
    }
    store.updateSrc(installId, entry.snapshot.src)
    return { installId, reverted: true, at: entry.at }
  },
}

/**
 * `plugins.install` — MisStore (misstore.hital.in) から既製プラグインを取得して
 * plugins store に追加する。AI が「○○の機能ない？」のように推薦から install
 * まで一気通貫で実行できるようにするためのラッパ。
 *
 * 内部実装は `useMisStoreStore.installPlugin(entry, forAccountIds)` を呼ぶだけ。
 * sha512 検証・parsePluginMeta・既存 storeId への installedFor union は
 * misstore store 側で実装済 (= 同 storeId のプラグインがあれば再インストール
 * せず installedFor に accountIds を追加するだけ)。インストール後は active=true で
 * 自動起動される (misstore.ts installPlugin の挙動)。
 */
export const pluginsInstallCapability: Command = {
  id: 'plugins.install',
  label: 'MisStore からプラグインを入れる',
  icon: 'ti-download',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.write', 'network.external'],
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
  signature: {
    description:
      'MisStore (misstore.hital.in) の既製プラグインをインストールする。' +
      ' id は `misstore.search` で取得した値を渡す。sha512 検証付き。' +
      ' 既に同 storeId のプラグインがあれば再インストールせず installedFor を' +
      ' 全 logged-in account で union 更新するだけ。',
    params: {
      id: {
        type: 'string',
        description: 'MisStore registry 上の plugin id',
      },
    },
    returns: {
      type: 'object',
      description: '{ id, name, installed: boolean }',
    },
  },
  visible: false,
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
    const accounts = useAccountsStore()
    const forAccountIds = accounts.accounts.map((a) => a.id)
    await misStore.installPlugin(entry, forAccountIds)
    return { id: entry.id, name: entry.name, installed: true }
  },
}

/**
 * `plugins.uninstall` — インストール済みプラグインを完全削除する。
 * `plugins.delete` と同等動作だが、命名を MisStore install/uninstall 対称形に
 * 揃え、storeId からも引けるエイリアス。AI が「MisStore で入れた○○外して」
 * と発話したとき id ベースで消せるよう、両方を受け付ける。
 */
export const pluginsUninstallCapability: Command = {
  id: 'plugins.uninstall',
  label: 'プラグインを削除',
  icon: 'ti-trash',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['plugins.write'],
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
  signature: {
    description:
      'インストール済みプラグインを完全削除する。installId か storeId の' +
      ' どちらかを渡す (両方渡されたら installId 優先)。' +
      ' plugins.delete と同等動作 (= AiScript ソース / メタ / Mk:save 領域すべて削除)。',
    params: {
      installId: {
        type: 'string',
        description: '対象プラグインの installId (plugins.list で取得)',
        optional: true,
      },
      storeId: {
        type: 'string',
        description:
          'MisStore registry 上の id (= plugins.install で渡した id)',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ installId, removed: boolean }',
    },
  },
  visible: false,
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
}

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

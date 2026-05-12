import type { Command } from '@/commands/registry'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'

interface PluginSnapshot {
  src: string
  name?: string
  version?: string
  permissions?: string[]
  active?: boolean
}

/**
 * Plugin 系 capability — AI が AiScript プラグインを動的に作成・編集できる
 * (= 「自己拡張する IDE」PR-D、memory: project_self_extending_ide_roadmap.md)。
 *
 * セキュリティ: 編集系は **`aiTool: false`** で AI 本体からの自発呼出しを
 * 塞ぐ (ai.chat と同じガード)。プラグインは widget と違い handler 登録で
 * バックグラウンド常時実行されうるため、AI が勝手に作るのは危険。一方
 * AiScript / コマンドパレット / HTTP API / CLI からは通常通り使える
 * (= ユーザー意図的トリガーは許容)。
 *
 * 読取系 (list / read) は無害なので `aiTool: true` のまま (AI が現在の
 * プラグイン構成を把握する用途は妥当)。
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
  aiTool: false, // AI 本体は自分でプラグインを作れない (バックグラウンド常時実行リスク)
  permissions: ['plugins.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'AiScript ソースから新規プラグインを作成する。aiTool:false の' +
      'ため AI チャット本体からは呼べない (handler 登録で常時実行される' +
      'リスクを回避)。AiScript / コマンドパレット / HTTP API / CLI から' +
      'は通常通り呼べる。permissions はプラグイン install 時のユーザー' +
      '承認スキーマに乗る。',
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
      active: {
        type: 'boolean',
        description: '作成直後に有効化するか (default: false)',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ installId, name, active }',
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
    const active = params?.active === true
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
      active,
    }
    const store = usePluginsStore()
    store.addPlugin(plugin)
    return { installId, name, active }
  },
}

export const pluginsUpdateCapability: Command = {
  id: 'plugins.update',
  label: 'プラグインの AiScript を更新',
  icon: 'ti-edit',
  category: 'general',
  shortcuts: [],
  aiTool: false, // AI 本体は自分でプラグインを書き換えられない
  permissions: ['plugins.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'プラグインの AiScript ソースを全文置換する。aiTool:false。' +
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
  aiTool: false, // AI 本体に勝手に有効化されると handler が突然動き出すため
  permissions: ['plugins.write'],
  signature: {
    description:
      'プラグインの active 状態を切り替える (可逆操作、aiTool:false)。',
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
  aiTool: false, // AI 本体に削除させない (アンインストール = 不可逆)
  permissions: ['plugins.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'プラグインを削除する。AiScript ソース・メタ・Mk:save 領域' +
      'すべて消える (= 不可逆、aiTool:false)。',
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
  aiTool: false, // AI 本体は plugins.write 系を呼べない (handler 常時実行リスク回避)
  permissions: ['plugins.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'プラグイン src を編集履歴の index 番目に戻す (aiTool:false)。',
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

export const PLUGINS_BUILTIN_CAPABILITIES: readonly Command[] = [
  pluginsListCapability,
  pluginsReadCapability,
  pluginsCreateCapability,
  pluginsUpdateCapability,
  pluginsSetActiveCapability,
  pluginsDeleteCapability,
  pluginsHistoryCapability,
  pluginsRevertCapability,
]

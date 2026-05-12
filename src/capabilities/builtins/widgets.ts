import type { Command } from '@/commands/registry'
import {
  generateWidgetId,
  useWidgetsStore,
  type WidgetMeta,
} from '@/stores/widgets'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'

interface WidgetSnapshot {
  src: string
  name?: string
  autoRun?: boolean
}

/**
 * Widget 系 capability — AI が AiScript ウィジェットを動的に作成・編集
 * できるようにする (= 「自己拡張する IDE」PR-C、memory:
 * project_self_extending_ide_roadmap.md)。
 *
 * ウィジェットは AiScript ソース + メタの 2 つで構成され (memory:
 * project_widgets_local_aiscript.md)、`autoRun: true` ならカラム表示時に
 * 自動実行される。AI が「ユーザーの好みに合わせた小道具」を提案できる。
 *
 * セキュリティ:
 * - 編集系は全て `requiresConfirmation: true` (= AI が任意のコードを
 *   ユーザー知らない間に作るのを防ぐ)
 * - AiScript の Mk:* / Nd:* permission は実行時に別途 plugin/widget の
 *   permission system が enforce する (= ここでは「ウィジェットを作る権限」
 *   のみ管理、ウィジェット内部の動作は別レイヤー)
 */

export const widgetsListCapability: Command = {
  id: 'widgets.list',
  label: 'ウィジェット一覧',
  icon: 'ti-layout-grid',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['widgets.read'],
  signature: {
    description:
      'インストール済みウィジェットのメタデータ一覧を返す。' +
      ' AiScript ソースは含まれない (src は widgets.read で個別取得)。',
    params: {},
    returns: {
      type: 'array',
      description: '{ installId, name, autoRun, storeId?, updatedAt } の配列',
    },
    cheap: true,
  },
  visible: false,
  execute: () => {
    const store = useWidgetsStore()
    return store.widgets.map((w) => ({
      installId: w.installId,
      name: w.name,
      autoRun: w.autoRun,
      storeId: w.storeId ?? null,
      updatedAt: w.updatedAt,
    }))
  },
}

export const widgetsReadCapability: Command = {
  id: 'widgets.read',
  label: 'ウィジェットの AiScript を読む',
  icon: 'ti-code',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['widgets.read'],
  signature: {
    description: '指定 installId のウィジェットの AiScript ソースを返す。',
    params: {
      installId: {
        type: 'string',
        description: '対象ウィジェットの installId (widgets.list で取得)',
      },
    },
    returns: {
      type: 'object',
      description: '{ installId, name, src, autoRun }',
    },
    cheap: true,
  },
  visible: false,
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) throw new Error('widgets.read: installId is required')
    const store = useWidgetsStore()
    const widget = store.getWidget(installId)
    if (!widget) {
      throw new Error(`widgets.read: widget "${installId}" not found`)
    }
    return {
      installId: widget.installId,
      name: widget.name,
      src: widget.src,
      autoRun: widget.autoRun,
    }
  },
}

export const widgetsCreateCapability: Command = {
  id: 'widgets.create',
  label: 'ウィジェットを作成',
  icon: 'ti-plus',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['widgets.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'AiScript ソースから新規ウィジェットを作成する。autoRun の' +
      ' default は false (= ユーザーが明示的に起動)。返り値の installId' +
      ' で以降 widgets.update / setAutoRun / delete を呼ぶ。',
    params: {
      name: { type: 'string', description: 'ウィジェット名 (UI 表示用)' },
      src: { type: 'string', description: 'AiScript ソースコード' },
      autoRun: {
        type: 'boolean',
        description: 'カラム表示時に自動実行するか (default: false)',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ installId, name, autoRun }',
    },
  },
  visible: false,
  execute: (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const autoRun = params?.autoRun === true
    if (!name) throw new Error('widgets.create: name is required')
    if (!src) throw new Error('widgets.create: src is required')
    const now = Date.now()
    const widget: WidgetMeta = {
      installId: generateWidgetId(),
      name,
      src,
      autoRun,
      createdAt: now,
      updatedAt: now,
    }
    const store = useWidgetsStore()
    store.addWidget(widget)
    return {
      installId: widget.installId,
      name: widget.name,
      autoRun: widget.autoRun,
    }
  },
}

export const widgetsUpdateCapability: Command = {
  id: 'widgets.update',
  label: 'ウィジェットの AiScript を更新',
  icon: 'ti-edit',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['widgets.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'ウィジェットの AiScript ソースを全文置換する。意図しない上書きを' +
      '防ぐため、事前に widgets.read で現状を取得してから差分判断して' +
      'から渡すことを推奨。',
    params: {
      installId: {
        type: 'string',
        description: '対象ウィジェットの installId',
      },
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
    if (!installId) throw new Error('widgets.update: installId is required')
    if (!src) throw new Error('widgets.update: src is required')
    const store = useWidgetsStore()
    if (!store.getWidget(installId)) {
      throw new Error(`widgets.update: widget "${installId}" not found`)
    }
    store.updateSrc(installId, src)
    return { installId, length: src.length }
  },
}

export const widgetsSetAutoRunCapability: Command = {
  id: 'widgets.setAutoRun',
  label: 'ウィジェットの自動実行を切替',
  icon: 'ti-player-play',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['widgets.write'],
  signature: {
    description: 'ウィジェットの autoRun フラグを切り替える (可逆操作)。',
    params: {
      installId: {
        type: 'string',
        description: '対象ウィジェットの installId',
      },
      autoRun: {
        type: 'boolean',
        description: 'true = 自動実行有効 / false = 無効',
      },
    },
    returns: {
      type: 'object',
      description: '{ installId, autoRun }',
    },
  },
  visible: false,
  execute: (params) => {
    const installId =
      typeof params?.installId === 'string' ? params.installId : ''
    if (!installId) {
      throw new Error('widgets.setAutoRun: installId is required')
    }
    const autoRun = params?.autoRun === true
    const store = useWidgetsStore()
    if (!store.getWidget(installId)) {
      throw new Error(`widgets.setAutoRun: widget "${installId}" not found`)
    }
    store.setAutoRun(installId, autoRun)
    return { installId, autoRun }
  },
}

export const widgetsDeleteCapability: Command = {
  id: 'widgets.delete',
  label: 'ウィジェットを削除',
  icon: 'ti-trash',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['widgets.write'],
  requiresConfirmation: true,
  signature: {
    description:
      'ウィジェットを削除する。AiScript ソース・メタ・Mk:save 領域' +
      'すべて消える (= 不可逆)。',
    params: {
      installId: {
        type: 'string',
        description: '対象ウィジェットの installId',
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
    if (!installId) throw new Error('widgets.delete: installId is required')
    const store = useWidgetsStore()
    const existed = !!store.getWidget(installId)
    store.removeWidget(installId)
    return { installId, removed: existed }
  },
}

export const widgetsHistoryCapability: Command = {
  id: 'widgets.history',
  label: 'ウィジェットの編集履歴',
  icon: 'ti-history',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['widgets.read'],
  signature: {
    description:
      '指定 installId のウィジェットの編集前 snapshot 一覧 (新しい順、最大 10 件) を返す。',
    params: {
      installId: {
        type: 'string',
        description: '対象ウィジェットの installId',
      },
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
    if (!installId) throw new Error('widgets.history: installId is required')
    const store = useWidgetsStore()
    const widget = store.getWidget(installId)
    if (!widget) {
      throw new Error(`widgets.history: widget "${installId}" not found`)
    }
    const basename = widget.name || widget.installId
    return await listSnapshots<WidgetSnapshot>('widget', basename)
  },
}

export const widgetsRevertCapability: Command = {
  id: 'widgets.revert',
  label: 'ウィジェットを過去の状態に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['widgets.write'],
  requiresConfirmation: true,
  signature: {
    description: 'ウィジェット src を編集履歴の index 番目に戻す。',
    params: {
      installId: {
        type: 'string',
        description: '対象ウィジェットの installId',
      },
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
    if (!installId) throw new Error('widgets.revert: installId is required')
    if (index < 0) throw new Error('widgets.revert: index must be >= 0')
    const store = useWidgetsStore()
    const widget = store.getWidget(installId)
    if (!widget) {
      throw new Error(`widgets.revert: widget "${installId}" not found`)
    }
    const basename = widget.name || widget.installId
    const entry = await getSnapshotAt<WidgetSnapshot>('widget', basename, index)
    if (!entry) {
      throw new Error(`widgets.revert: no snapshot at index ${index}`)
    }
    store.updateSrc(installId, entry.snapshot.src)
    return { installId, reverted: true, at: entry.at }
  },
}

export const WIDGETS_BUILTIN_CAPABILITIES: readonly Command[] = [
  widgetsListCapability,
  widgetsReadCapability,
  widgetsCreateCapability,
  widgetsUpdateCapability,
  widgetsSetAutoRunCapability,
  widgetsDeleteCapability,
  widgetsHistoryCapability,
  widgetsRevertCapability,
]

import type { Command } from '@/commands/registry'
import { useAccountsStore } from '@/stores/accounts'
import type { ColumnType, DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'

/**
 * `column.add` で受け付けるカラム種別。lookup ID 必須カラム (list / antenna /
 * channel / clip / user) は対応する `*Id` を `params` で渡せばここから追加できる。
 * `widget` / `aiscript` / `play` / `page` 等は固有の生成フローが必要なため
 * 引き続き専用 UI 経由で追加する。
 */
const ADDABLE_COLUMN_TYPES: readonly ColumnType[] = [
  // 引数なしで開けるシンプル系
  'timeline',
  'notifications',
  'mentions',
  'specified',
  'search',
  'favorites',
  'drive',
  'gallery',
  'explore',
  'memos',
  'charts',
  'federation',
  'aboutMisskey',
  'announcements',
  'achievements',
  'followRequests',
  'apiConsole',
  'apiDocs',
  'lookup',
  'serverInfo',
  'streamInspector',
  'pluginManager',
  'themeManager',
  'taskRunner',
  'skill',
  'ai',
  'chat',
  'emoji',
  'ads',
  // lookup ID 必須カラム
  'list',
  'antenna',
  'channel',
  'clip',
  'user',
] as const

/** type と必須 lookup ID の対応表 */
const LOOKUP_ID_REQUIRED: Partial<Record<ColumnType, keyof DeckColumn>> = {
  list: 'listId',
  antenna: 'antennaId',
  channel: 'channelId',
  clip: 'clipId',
  user: 'userId',
}

/**
 * `column.list` — 現在のデッキに存在するカラム一覧を返す。
 * AI が「このユーザーは今どのカラムを開いているか」を理解できる。
 */
export const columnListCapability: Command = {
  id: 'column.list',
  label: 'カラム一覧',
  icon: 'ti-columns',
  category: 'column',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在開かれているカラムを配列で返す。各要素は' +
      ' `{ id, type, name, accountId, accountHost }` を含む。' +
      ' accountHost を見れば「どれが misskey.io のカラムか」を' +
      ' account.list を呼ばずに判定できる。',
    params: {},
    returns: {
      type: 'array',
      description:
        'DeckColumn 軽量 projection の配列 (id / type / name / accountId / accountHost)',
    },
    // deck store 照会のみ、API 呼び出しなし
    cheap: true,
  },
  visible: false,
  execute: () => {
    const accounts = useAccountsStore().accounts
    const hostById = new Map(accounts.map((a) => [a.id, a.host]))
    return useDeckStore().columns.map((c) => {
      const host = c.accountId ? hostById.get(c.accountId) : undefined
      return {
        id: c.id,
        type: c.type,
        name: c.name,
        accountId: c.accountId,
        ...(host ? { accountHost: host } : {}),
      }
    })
  },
}

/**
 * `column.add` — 新しいカラムをデッキに追加する。
 * AI が「ノートのカラムを追加して」と頼まれたときに呼ぶ。AiScript プラグインからも
 * `Nd:call('column.add', ...)` 経由で同じ entrypoint を呼ぶ。
 *
 * list / antenna / channel / clip / user は対応する lookup ID
 * (`listId` / `antennaId` 等) を渡す必要がある。
 */
export const columnAddCapability: Command = {
  id: 'column.add',
  label: 'カラムを追加',
  icon: 'ti-plus',
  category: 'column',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '新しいカラムをデッキに追加する。type で種別を指定する。' +
      ' list / antenna / channel / clip / user は対応する lookup ID' +
      ' (`listId` / `antennaId` / `channelId` / `clipId` / `userId`) が必要。',
    params: {
      type: {
        type: 'string',
        description: '追加するカラムの種別',
        enum: ADDABLE_COLUMN_TYPES,
      },
      name: {
        type: 'string',
        description: 'カラムのタイトル (空または省略時は自動)',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: 'どのアカウントのカラムにするか (省略時は cross-account)',
        optional: true,
      },
      width: {
        type: 'number',
        description: 'カラム幅 px (default 380)',
        optional: true,
      },
      listId: {
        type: 'string',
        description: 'type=list のとき必須',
        optional: true,
      },
      antennaId: {
        type: 'string',
        description: 'type=antenna のとき必須',
        optional: true,
      },
      channelId: {
        type: 'string',
        description: 'type=channel のとき必須',
        optional: true,
      },
      clipId: {
        type: 'string',
        description: 'type=clip のとき必須',
        optional: true,
      },
      userId: {
        type: 'string',
        description: 'type=user のとき必須',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '追加されたカラムの { id, type }',
    },
  },
  visible: false,
  execute: (params) => {
    const type = typeof params?.type === 'string' ? params.type : ''
    if (!ADDABLE_COLUMN_TYPES.includes(type as ColumnType)) {
      throw new Error(
        `Unsupported column type "${type}". ` +
          `Supported: ${ADDABLE_COLUMN_TYPES.join(', ')}`,
      )
    }
    const requiredIdKey = LOOKUP_ID_REQUIRED[type as ColumnType]
    if (requiredIdKey && typeof params?.[requiredIdKey] !== 'string') {
      throw new Error(`${requiredIdKey} is required for column type "${type}"`)
    }
    const partial: Omit<DeckColumn, 'id'> = {
      type: type as ColumnType,
      name: typeof params?.name === 'string' ? params.name : null,
      width: typeof params?.width === 'number' ? params.width : 380,
      accountId:
        typeof params?.accountId === 'string' ? params.accountId : null,
    }
    for (const idKey of [
      'listId',
      'antennaId',
      'channelId',
      'clipId',
      'userId',
    ] as const) {
      const v = params?.[idKey]
      if (typeof v === 'string') partial[idKey] = v
    }
    const col = useDeckStore().addColumn(partial)
    return { id: col.id, type: col.type }
  },
}

/**
 * `column.remove` — 指定 ID のカラムをデッキから削除する。
 * 該当カラムが無ければ no-op (= 二重実行に強い)。
 */
export const columnRemoveCapability: Command = {
  id: 'column.remove',
  label: 'カラムを削除',
  icon: 'ti-trash',
  category: 'column',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '指定したカラムをデッキから削除する。該当カラムが無ければ no-op。' +
      ' 削除対象 ID は `column.list` の戻り値から取得する。',
    params: {
      id: {
        type: 'string',
        description: '削除対象カラム ID',
      },
    },
    returns: { type: 'void' },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('id is required')
    useDeckStore().removeColumn(id)
  },
}

export const COLUMN_BUILTIN_CAPABILITIES: readonly Command[] = [
  columnListCapability,
  columnAddCapability,
  columnRemoveCapability,
]

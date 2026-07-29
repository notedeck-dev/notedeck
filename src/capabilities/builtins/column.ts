import { ALL_COLUMN_TYPES, COLUMN_REGISTRY } from '@/columns/registry'
import type { Command } from '@/commands/registry'
import { useAccountsStore } from '@/stores/accounts'
import type { ColumnType, DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'

/**
 * `column.add` で受け付けるカラム種別 (#794 W2)。
 *
 * 手書きの許可リストではなくカラムレジストリから導出する。手書きだと種別を
 * 足すたびに更新漏れが起き (実際に role が抜けていた)、実行時登録された
 * プラグイン定義カラムは原理的に載せられない。
 *
 * 除外するのは「先に中身を作る」固有フローを持つ種別 (customAddFlow) だけ。
 */
function addableColumnTypes(): readonly ColumnType[] {
  return ALL_COLUMN_TYPES.filter((t) => !COLUMN_REGISTRY[t]?.customAddFlow)
}

/**
 * type と必須 lookup ID の対応表。レジストリの `selectable.idKey` が正本。
 */
function lookupIdKey(type: ColumnType): keyof DeckColumn | undefined {
  return COLUMN_REGISTRY[type]?.selectable?.idKey
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
  permissions: ['deck.read'],
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
 * `column.active` — 現在フォーカスされているカラムを返す。
 * AI / プラグインが「ユーザーが今見てる文脈」を最小限把握するための入口。
 * フォーカス対象がない / カラムが無い場合は { column: null }。
 *
 * カラム内の「フォーカスされたノート」は composable scope に閉じているため
 * 本 capability では扱わない (Phase 2 で store 持ち上げ + 別 capability で対応)。
 */
export const columnActiveCapability: Command = {
  id: 'column.active',
  label: 'アクティブなカラムを取得',
  icon: 'ti-columns',
  category: 'column',
  shortcuts: [],
  aiTool: true,
  permissions: ['deck.read'],
  signature: {
    description:
      '現在フォーカスされているカラム情報を返す。なければ' +
      ' { column: null }。column.list より軽量で、AI が「今ユーザーが' +
      '見てる場所」を 1 呼び出しで把握できる。',
    params: {},
    returns: {
      type: 'object',
      description:
        '{ column: { id, type, name, accountId, tl?, query?, listId?, ... } | null }',
    },
    cheap: true,
  },
  visible: false,
  execute: () => {
    const store = useDeckStore()
    const id = store.activeColumnId
    if (!id) return { column: null }
    const col = store.getColumn(id)
    if (!col) return { column: null }
    return {
      column: {
        id: col.id,
        type: col.type,
        name: col.name,
        accountId: col.accountId,
        ...(col.tl ? { tl: col.tl } : {}),
        ...(col.query ? { query: col.query } : {}),
        ...(col.listId ? { listId: col.listId } : {}),
        ...(col.antennaId ? { antennaId: col.antennaId } : {}),
        ...(col.channelId ? { channelId: col.channelId } : {}),
        ...(col.clipId ? { clipId: col.clipId } : {}),
        ...(col.userId ? { userId: col.userId } : {}),
      },
    }
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
        // getter: tool schema は呼び出しのたびに組まれるので、実行時登録
        // された種別もそのまま AI に見える
        get enum() {
          return addableColumnTypes()
        },
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
      tl: {
        type: 'string',
        description:
          'type=timeline のときのタイムライン種別 (home / local / social / global)',
        optional: true,
      },
      query: {
        type: 'string',
        description: 'type=search のときの検索クエリ',
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
    const addable = addableColumnTypes()
    if (!addable.includes(type as ColumnType)) {
      throw new Error(
        `Unsupported column type "${type}". ` +
          `Supported: ${addable.join(', ')}`,
      )
    }
    const requiredIdKey = lookupIdKey(type as ColumnType)
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
    if (typeof params?.tl === 'string') partial.tl = params.tl
    if (typeof params?.query === 'string') partial.query = params.query
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

/**
 * `column.focusedNote` — 現在 active なカラムで focus されているノートを返す。
 * `useNoteFocus` から deck store に持ち上げられた `focusedNoteIdByColumn` を
 * 引いて、対応するノートメタを返す。AI Actions プラグインが「ユーザーが今見て
 * るノートを翻訳」のような操作で使う。
 *
 * カラムが active でない / focus されたノートがない場合は { note: null }。
 */
export const columnFocusedNoteCapability: Command = {
  id: 'column.focusedNote',
  label: 'フォーカス中のノートを取得',
  icon: 'ti-target',
  category: 'column',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      '現在 active なカラム内で focus 中のノートを返す。未 focus / active' +
      'カラムが none の場合は { note: null }。AI Actions が「これ翻訳」のような' +
      '操作で使う。',
    params: {},
    returns: {
      type: 'object',
      description:
        '{ columnId, noteId, note: { id, text, userId, ... } } | { note: null }',
    },
    cheap: true,
  },
  visible: false,
  execute: () => {
    const store = useDeckStore()
    const columnId = store.activeColumnId
    if (!columnId) return { note: null }
    const noteId = store.focusedNoteIdByColumn.get(columnId)
    if (!noteId) return { note: null }
    const notes = store.visibleNotesByColumn[columnId] as
      | NormalizedNoteLike[]
      | undefined
    const note = notes?.find((n) => n.id === noteId) ?? null
    if (!note) return { note: null }
    return {
      columnId,
      noteId,
      note: {
        id: note.id,
        text: note.text ?? null,
        userId: note.userId ?? null,
        createdAt: note.createdAt ?? null,
        cw: note.cw ?? null,
        renoteId: note.renoteId ?? null,
        replyId: note.replyId ?? null,
      },
    }
  },
}

interface NormalizedNoteLike {
  id: string
  text?: string | null
  userId?: string | null
  createdAt?: string | null
  cw?: string | null
  renoteId?: string | null
  replyId?: string | null
}

/**
 * `column.move` — 既存カラムを指定インデックスに移動。layout が group の
 * 配列なので、ここでは「単一カラムを 1 グループとして指定位置に挿入」する
 * insertColumnAt の薄ラッパー。AI が「○○カラムを左に」と言ったときに使う。
 */
export const columnMoveCapability: Command = {
  id: 'column.move',
  label: 'カラムを移動',
  icon: 'ti-arrows-horizontal',
  category: 'column',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '既存カラムを指定インデックスに移動する。targetIndex は 0 ベース ' +
      '(0 = 最左)。column.list の並び順 (= layout group 順) と一致。',
    params: {
      columnId: { type: 'string', description: '対象 columnId' },
      targetIndex: {
        type: 'number',
        description: '移動先 index (0 = 最左、layout group 配列の位置)',
      },
    },
    returns: {
      type: 'object',
      description: '{ moved: true, columnId, targetIndex }',
    },
  },
  visible: false,
  execute: (params) => {
    const columnId = typeof params?.columnId === 'string' ? params.columnId : ''
    if (!columnId) throw new Error('column.move: columnId is required')
    const targetIndexRaw =
      typeof params?.targetIndex === 'number' ? params.targetIndex : NaN
    if (!Number.isFinite(targetIndexRaw)) {
      throw new Error('column.move: targetIndex must be a finite number')
    }
    const targetIndex = Math.max(0, Math.floor(targetIndexRaw))
    const store = useDeckStore()
    store.insertColumnAt(columnId, targetIndex)
    return { moved: true, columnId, targetIndex }
  },
}

/**
 * AI 経由で更新できる安全フィールド。type / accountId / listId 等の identity
 * フィールドは触らない (= 「list カラム A」を「list カラム B」に書き換える
 * のは破壊的)。
 */
const SAFE_COLUMN_UPDATE_FIELDS = [
  'name',
  'width',
  'query',
  'soundMuted',
] as const
type SafeColumnUpdateField = (typeof SAFE_COLUMN_UPDATE_FIELDS)[number]

/**
 * `column.updateSettings` — 既存カラムの安全な表示プロパティ (name / width /
 * query / soundMuted) のみを更新。identity (type / accountId 等) は触らない。
 */
export const columnUpdateSettingsCapability: Command = {
  id: 'column.updateSettings',
  label: 'カラム設定を更新',
  icon: 'ti-adjustments',
  category: 'column',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '既存カラムの表示プロパティ (name / width / query / soundMuted) を更新する。' +
      ' identity 系 (type / accountId / listId 等) は触れない (= AI 経路で塞ぐ)。',
    params: {
      columnId: { type: 'string', description: '対象 columnId' },
      name: {
        type: 'string',
        description: 'カラム表示名 (空文字でリセット)',
        optional: true,
      },
      width: {
        type: 'number',
        description: 'カラム幅 (px)',
        optional: true,
      },
      query: {
        type: 'string',
        description: 'search カラムなどの検索クエリ',
        optional: true,
      },
      soundMuted: {
        type: 'boolean',
        description: 'カラム単位のサウンドミュート',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description:
        '{ updated: true, columnId, applied: 適用したフィールド名の配列 }',
    },
  },
  visible: false,
  execute: (params) => {
    const columnId = typeof params?.columnId === 'string' ? params.columnId : ''
    if (!columnId) {
      throw new Error('column.updateSettings: columnId is required')
    }
    const updates: Partial<DeckColumn> = {}
    const applied: SafeColumnUpdateField[] = []
    if (typeof params?.name === 'string') {
      updates.name = params.name.length > 0 ? params.name : null
      applied.push('name')
    }
    if (typeof params?.width === 'number' && Number.isFinite(params.width)) {
      updates.width = Math.max(120, Math.floor(params.width))
      applied.push('width')
    }
    if (typeof params?.query === 'string') {
      updates.query = params.query
      applied.push('query')
    }
    if (typeof params?.soundMuted === 'boolean') {
      updates.soundMuted = params.soundMuted
      applied.push('soundMuted')
    }
    if (applied.length === 0) {
      throw new Error(
        'column.updateSettings: at least one of name/width/query/soundMuted is required',
      )
    }
    const store = useDeckStore()
    store.updateColumn(columnId, updates)
    return { updated: true, columnId, applied }
  },
}

/**
 * `sidebar.toggle` — サイドバースロット (左ナビバー連動の単一カラム枠) を
 * 指定 type で開閉する。既に同 type が開いていれば閉じる (toggle 動作)。
 *
 * 「サイドバーで通知を開いて」のような AI 依頼に対応するための capability。
 * `column.add` (デッキに新規追加) とは別物: こちらは置換式の単一スロットを
 * 操作する (= ナビバーボタンをクリックしたのと同じ動作)。
 */
export const sidebarToggleCapability: Command = {
  id: 'sidebar.toggle',
  label: 'サイドバーで開閉',
  icon: 'ti-layout-sidebar',
  category: 'column',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      'サイドバースロットを指定タイプで開く (既に同タイプなら閉じる)。' +
      ' navbar ボタンクリックと同じ動作。デッキへの新規追加ではない。',
    params: {
      type: {
        type: 'string',
        description:
          'カラム種別 (notifications / chat / search / ai / memos など)',
        // getter: tool schema は呼び出しのたびに組まれるので、実行時登録
        // された種別もそのまま AI に見える
        get enum() {
          return addableColumnTypes()
        },
      },
      accountId: {
        type: 'string',
        description: 'アカウント ID。省略時は cross-account (null)',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ type, opened: true 開いた / false 閉じた }',
    },
  },
  visible: false,
  execute: (params) => {
    const type = typeof params?.type === 'string' ? params.type : ''
    const addable = addableColumnTypes()
    if (!addable.includes(type as ColumnType)) {
      throw new Error(
        `Unsupported column type "${type}". ` +
          `Supported: ${addable.join(', ')}`,
      )
    }
    const accountId =
      typeof params?.accountId === 'string' ? params.accountId : null
    const deck = useDeckStore()
    deck.toggleSidebarColumn(type as ColumnType, accountId)
    const after = deck.columns.find((c) => c.sidebar)
    const opened = after != null && after.type === type
    return { type, opened }
  },
}

export const COLUMN_BUILTIN_CAPABILITIES: readonly Command[] = [
  columnActiveCapability,
  columnFocusedNoteCapability,
  columnListCapability,
  columnAddCapability,
  columnRemoveCapability,
  columnMoveCapability,
  columnUpdateSettingsCapability,
  sidebarToggleCapability,
]

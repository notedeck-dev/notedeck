import { ALL_COLUMN_TYPES, COLUMN_REGISTRY } from '@/columns/registry'
import type { Command } from '@/commands/registry'
import { parseVariantKey } from '@/services/noteKey'
import { useAccountsStore } from '@/stores/accounts'
import type { ColumnType, DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { implement } from '../declare'

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
export const columnListCapability = implement('column.list', {
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
})

/**
 * `column.active` — 現在フォーカスされているカラムを返す。
 * AI / プラグインが「ユーザーが今見てる文脈」を最小限把握するための入口。
 * フォーカス対象がない / カラムが無い場合は { column: null }。
 *
 * カラム内の「フォーカスされたノート」は composable scope に閉じているため
 * 本 capability では扱わない (Phase 2 で store 持ち上げ + 別 capability で対応)。
 */
export const columnActiveCapability = implement('column.active', {
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
})

/**
 * `column.add` — 新しいカラムをデッキに追加する。
 * AI が「ノートのカラムを追加して」と頼まれたときに呼ぶ。AiScript プラグインからも
 * `Nd:call('column.add', ...)` 経由で同じ entrypoint を呼ぶ。
 *
 * list / antenna / channel / clip / user は対応する lookup ID
 * (`listId` / `antennaId` 等) を渡す必要がある。
 */
export const columnAddCapability = implement('column.add', {
  // 実行時登録された種別 (plugin 由来) も AI に見せる
  enumOf: { type: addableColumnTypes },
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
})

/**
 * `column.remove` — 指定 ID のカラムをデッキから削除する。
 * 該当カラムが無ければ no-op (= 二重実行に強い)。
 */
export const columnRemoveCapability = implement('column.remove', {
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('id is required')
    useDeckStore().removeColumn(id)
  },
})

/**
 * `column.focusedNote` — 現在 active なカラムで focus されているノートを返す。
 * `useNoteFocus` から deck store に持ち上げられた `focusedNoteKeyByColumn` を
 * 引いて、対応するノートメタを返す。AI Actions プラグインが「ユーザーが今見て
 * るノートを翻訳」のような操作で使う。
 *
 * カラムが active でない / focus されたノートがない場合は { note: null }。
 */
export const columnFocusedNoteCapability = implement('column.focusedNote', {
  execute: () => {
    const store = useDeckStore()
    const columnId = store.activeColumnId
    if (!columnId) return { note: null }
    const key = store.focusedNoteKeyByColumn.get(columnId)
    if (!key) return { note: null }
    const { accountId, noteId } = parseVariantKey(key)
    const notes = store.visibleNotesByColumn[columnId] as
      | NormalizedNoteLike[]
      | undefined
    const note =
      notes?.find((n) => n.id === noteId && n._accountId === accountId) ?? null
    if (!note) return { note: null }
    return {
      columnId,
      noteId,
      // ノート ID はサーバー内でしか一意でないため、操作するアカウントを添える (#1010)
      accountId,
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
})

interface NormalizedNoteLike {
  id: string
  _accountId?: string
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
export const columnMoveCapability = implement('column.move', {
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
})

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
export const columnUpdateSettingsCapability = implement(
  'column.updateSettings',
  {
    execute: (params) => {
      const columnId =
        typeof params?.columnId === 'string' ? params.columnId : ''
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
  },
)

/**
 * `sidebar.toggle` — サイドバースロット (左ナビバー連動の単一カラム枠) を
 * 指定 type で開閉する。既に同 type が開いていれば閉じる (toggle 動作)。
 *
 * 「サイドバーで通知を開いて」のような AI 依頼に対応するための capability。
 * `column.add` (デッキに新規追加) とは別物: こちらは置換式の単一スロットを
 * 操作する (= ナビバーボタンをクリックしたのと同じ動作)。
 */
export const sidebarToggleCapability = implement('sidebar.toggle', {
  // 実行時登録された種別 (plugin 由来) も AI に見せる
  enumOf: { type: addableColumnTypes },
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
})

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

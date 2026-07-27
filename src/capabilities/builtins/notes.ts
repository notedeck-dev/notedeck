import type { TimelineType } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { ACCOUNT_ID_PARAM_DESC, getApiAdapter } from '../accountContext'

/**
 * AI が 1 回の capability 呼び出しで取得できるノートの上限。
 * Misskey API 自体の上限 (/notes/* 系は 100) と揃える。AI が「続き」を
 * 取りたいときは untilId 指定で再呼び出しすればページング可能。
 */
const MAX_NOTES_PER_CALL = 100
/** params.limit を省略 / 不正値だった場合のデフォルト件数 */
const DEFAULT_LIMIT = 10

const VALID_TIMELINE_TYPES: readonly TimelineType[] = [
  'home',
  'local',
  'social',
  'global',
] as const

function clampLimit(input: unknown, fallback = DEFAULT_LIMIT): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.max(1, Math.min(MAX_NOTES_PER_CALL, Math.floor(input)))
}

function pickUntilId(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * AI tool description に共通で追記する `accountId` パラメタの説明文。
 * AI が `<currentAccount>` と `<currentColumn>` の差を見て、別サーバーの
 * カラムを読みたいときは `<currentColumn>.accountId` を渡せるよう示唆する。
 */
const ACCOUNT_ID_HINT =
  '`accountId` 未指定なら active アカウントを使う。' +
  ' active と異なるサーバーのカラムを読みたいときは `<currentColumn>.accountId` を渡す。'

/** `notes.search` — Misskey の /notes/search 経由でキーワード検索 */
export const notesSearchCapability: Command = {
  id: 'notes.search',
  label: 'ノート検索',
  icon: 'ti-search',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      'キーワードでノートを全文検索する。Misskey の /notes/search を使う。' +
      ' 結果は note projection (id / userId / username / text / createdAt) で返す。' +
      ' 100 件を超えて取得したい場合は、最後のノートの id を untilId に渡して再呼び出し。' +
      ` ${ACCOUNT_ID_HINT}`,
    params: {
      query: {
        type: 'string',
        description: '検索キーワード (空文字は不可)',
      },
      limit: {
        type: 'number',
        description: '取得件数 (1-100, default 10)',
        optional: true,
      },
      untilId: {
        type: 'string',
        description:
          'この ID より前のノートを取得 (ページング用)。前回呼び出しの最後のノートの id を渡す。',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: 'ノート projection の配列',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const query = typeof params?.query === 'string' ? params.query.trim() : ''
    if (!query) throw new Error('notes.search: query is required')
    const limit = clampLimit(params?.limit)
    const untilId = pickUntilId(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.searchNotes(query, { limit, untilId })
    return projectVisibleItems(notes, 'search', limit)
  },
}

/** `notes.timeline` — home / local / social / global タイムライン取得 */
export const notesTimelineCapability: Command = {
  id: 'notes.timeline',
  label: 'タイムライン取得',
  icon: 'ti-list',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      'タイムラインを取得する。home はログイン中のフォロー含むホーム、' +
      ' local はサーバー内ローカル、social はホーム+ローカル混合、' +
      ' global は連合宇宙全体。' +
      ' 100 件を超えて取得したい場合は、最後のノートの id を untilId に渡して再呼び出し。' +
      ` ${ACCOUNT_ID_HINT}`,
    params: {
      type: {
        type: 'string',
        description: 'タイムラインの種類',
        enum: VALID_TIMELINE_TYPES,
      },
      limit: {
        type: 'number',
        description: '取得件数 (1-100, default 10)',
        optional: true,
      },
      untilId: {
        type: 'string',
        description:
          'この ID より前のノートを取得 (ページング用)。前回呼び出しの最後のノートの id を渡す。',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: 'ノート projection の配列',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const type = typeof params?.type === 'string' ? params.type : ''
    if (!VALID_TIMELINE_TYPES.includes(type as TimelineType)) {
      throw new Error(
        `notes.timeline: invalid type "${type}". Valid: ${VALID_TIMELINE_TYPES.join(', ')}`,
      )
    }
    const limit = clampLimit(params?.limit)
    const untilId = pickUntilId(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getTimeline(type as TimelineType, {
      limit,
      untilId,
    })
    return projectVisibleItems(notes, 'timeline', limit)
  },
}

/** `notes.user` — 特定ユーザーの最近のノート取得 */
export const notesUserCapability: Command = {
  id: 'notes.user',
  label: 'ユーザーのノート取得',
  icon: 'ti-user',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      '特定ユーザーの最近のノートを取得する。userId は Misskey の内部 ID' +
      ' (username ではなく)。' +
      ' 100 件を超えて取得したい場合は、最後のノートの id を untilId に渡して再呼び出し。' +
      ` ${ACCOUNT_ID_HINT}`,
    params: {
      userId: {
        type: 'string',
        description: 'Misskey の内部 user ID',
      },
      limit: {
        type: 'number',
        description: '取得件数 (1-100, default 10)',
        optional: true,
      },
      untilId: {
        type: 'string',
        description:
          'この ID より前のノートを取得 (ページング用)。前回呼び出しの最後のノートの id を渡す。',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: 'ノート projection の配列',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const userId =
      typeof params?.userId === 'string' ? params.userId.trim() : ''
    if (!userId) throw new Error('notes.user: userId is required')
    const limit = clampLimit(params?.limit)
    const untilId = pickUntilId(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getUserNotes(userId, { limit, untilId })
    return projectVisibleItems(notes, 'user', limit)
  },
}

/** `notes.show` — 単一ノートを ID で取得 */
export const notesShowCapability: Command = {
  id: 'notes.show',
  label: 'ノート取得',
  icon: 'ti-note',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      'noteId で 1 件のノートを取得する。リプライ先や引用元の本文を見たい' +
      ' ときに使う。戻り値は単一の note projection (配列ではない)。' +
      ` ${ACCOUNT_ID_HINT}`,
    params: {
      noteId: {
        type: 'string',
        description: 'Misskey 内部の note ID',
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description:
        'note projection (id / userId / username / text / createdAt)',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const noteId =
      typeof params?.noteId === 'string' ? params.noteId.trim() : ''
    if (!noteId) throw new Error('notes.show: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    const note = await api.getNote(noteId)
    // 配列を経由するが結果は 1 件目を返す (projection を再利用するため)
    return projectVisibleItems([note], 'search', 1)[0] ?? null
  },
}

/** `notes.children` — 指定ノートへのリプライ (子ノート) を取得 */
export const notesChildrenCapability: Command = {
  id: 'notes.children',
  label: 'リプライ取得',
  icon: 'ti-corner-down-right',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      '指定ノートへの直接リプライ (= 子ノート) を取得する。会話のスレッドを' +
      ' 辿りたいときに使う。' +
      ' 100 件を超えて取得したい場合は、最後のノートの id を untilId に渡して再呼び出し。' +
      ` ${ACCOUNT_ID_HINT}`,
    params: {
      noteId: {
        type: 'string',
        description: '親ノートの Misskey 内部 ID',
      },
      limit: {
        type: 'number',
        description: '取得件数 (1-100, default 10)',
        optional: true,
      },
      untilId: {
        type: 'string',
        description:
          'この ID より前のリプライを取得 (ページング用)。前回呼び出しの最後のノートの id を渡す。',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: 'ノート projection の配列',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const noteId =
      typeof params?.noteId === 'string' ? params.noteId.trim() : ''
    if (!noteId) throw new Error('notes.children: noteId is required')
    const limit = clampLimit(params?.limit)
    const untilId = pickUntilId(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getNoteChildren(noteId, { limit, untilId })
    return projectVisibleItems(notes, 'search', limit)
  },
}

export const NOTES_BUILTIN_CAPABILITIES: readonly Command[] = [
  notesSearchCapability,
  notesTimelineCapability,
  notesUserCapability,
  notesShowCapability,
  notesChildrenCapability,
]

import type { NormalizedNote, TimelineType } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'
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
  '`accountId` 未指定なら呼び出し文脈のアカウント (per-account の AI カラムならその' +
  ' アカウント) を使う。文脈が無い全アカウントのカラムでは `account.list` か' +
  ' `<currentColumn>.accountId` から選んで渡す。'

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

function pickString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const t = input.trim()
  return t.length > 0 ? t : undefined
}

/**
 * `notes.searchArchive` — 手元の索引 (キャッシュ) をサーバー・アカウント横断で
 * 引く (#947)。サーバー検索 (`notes.search`) では答えられない「いつか見たノート」に
 * 届く。索引にはフォロワー限定 / ダイレクトも入っているので、権限は
 * `notes.readArchive` (既定は閉じる) に分け、公開範囲も既定で public だけ。
 * ローカル DB の読取なので adapter を通さず Tauri command を直接呼ぶ
 * (Misskey API ではないためフォーク差異の対象外)。
 */
export const notesSearchArchiveCapability: Command = {
  id: 'notes.searchArchive',
  label: '手元の索引を検索',
  icon: 'ti-archive',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.readArchive'],
  signature: {
    description:
      '手元に貯めたノート (自分の画面に流れてきたもの) を、サーバーとアカウントを' +
      ' 跨いでまとめて検索する。「先週〇〇の話をしていた人は誰か」のような、' +
      ' サーバー検索では引けない過去の記憶に答えるための道具。query / author /' +
      ' since / until / hasFiles は全部任意で、AND で絞る (全部省略すると新しい順に' +
      ' 並べるだけ)。既定では公開範囲が public のノートだけを返す。' +
      ' 結果は note projection に accountId (どのアカウントで見たか) と serverHost' +
      ' (そのサーバー) を足したもの。同じノートを複数サーバーで見ていれば複数行になる。' +
      ' 続きを取るときは最後のノートの createdAt を until に渡して再呼び出し。',
    params: {
      query: {
        type: 'string',
        description: '本文の検索語 (部分一致)。省略可',
        optional: true,
      },
      author: {
        type: 'string',
        description: '投稿者。`name` または `name@host`。省略可',
        optional: true,
      },
      since: {
        type: 'string',
        description: 'この日時 (ISO 8601) 以降。省略可',
        optional: true,
      },
      until: {
        type: 'string',
        description: 'この日時 (ISO 8601) 以前。ページングにも使う。省略可',
        optional: true,
      },
      hasFiles: {
        type: 'boolean',
        description: 'true = 添付あり、false = 添付なし。省略時は問わない',
        optional: true,
      },
      includePrivate: {
        type: 'boolean',
        description:
          'フォロワー限定・ダイレクトも含める。既定 false (public だけ)。' +
          ' ユーザーが明示的に求めたときだけ true にする',
        optional: true,
      },
      accountIds: {
        type: 'array',
        description:
          '検索対象のアカウント ID 列 (account.list で得られる)。省略時は全アカウント',
        optional: true,
      },
      limit: {
        type: 'number',
        description: '取得件数 (1-100, default 10)',
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description:
        'ノート projection (id / userId / username / text / createdAt) + accountId / serverHost の配列',
    },
  },
  visible: false,
  execute: async (params) => {
    const accountsStore = useAccountsStore()
    const known = new Set(accountsStore.accounts.map((a) => a.id))
    const requested = Array.isArray(params?.accountIds)
      ? params.accountIds.filter(
          (id): id is string => typeof id === 'string' && known.has(id),
        )
      : undefined
    const accountIds = requested ?? [...known]
    if (accountIds.length === 0) return []
    const limit = clampLimit(params?.limit)
    const includePrivate = params?.includePrivate === true
    const hasFiles =
      typeof params?.hasFiles === 'boolean' ? params.hasFiles : null
    const notes = unwrap(
      await commands.apiSearchNotesCachedAcross(
        accountIds,
        pickString(params?.query) ?? '',
        limit,
        pickString(params?.since) ?? null,
        pickString(params?.until) ?? null,
        false,
        pickString(params?.author) ?? null,
        hasFiles,
        !includePrivate,
      ),
    ) as NormalizedNote[]
    const projected = projectVisibleItems(notes, 'search', limit)
    return projected.map((p, i) => ({
      ...p,
      accountId: notes[i]?._accountId,
      serverHost: notes[i]?._serverHost,
    }))
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
  notesSearchArchiveCapability,
  notesTimelineCapability,
  notesUserCapability,
  notesShowCapability,
  notesChildrenCapability,
]

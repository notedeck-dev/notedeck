import type { NoteVisibility } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import {
  type DraftData,
  deleteDraft,
  loadAllDrafts,
  refreshDrafts,
  type StoredDraft,
  saveDraft,
} from '@/composables/useDrafts'
import { useAccountsStore } from '@/stores/accounts'

/**
 * Drafts (Misskey notes/drafts/* — 2025.6+) 系 capability。
 *
 * AI 経路で塞がっていた「下書きの整理・転記・作成」を開放する
 * (memory: feedback_ai_capability_scope のユーザー操作系)。下書きは
 * 公開しない private content なので notes.write より弱い権限 `drafts.write`
 * で管理。`saveDraft` / `deleteDraft` composable を経由するため、
 * draftsVersion ref 経由で UI 一覧も自動更新される。
 *
 * 設計判断:
 * - 単一 draft fetch API は Misskey に無いため `drafts.read` ではなく
 *   `drafts.list` だけを提供 (= 全件返す + AI がフィルタする)
 * - update は不完全パッチ可能 (現 draft とマージ)
 * - delete は warning タイプの確認 (= 失われると戻せない)
 */

const VALID_VISIBILITIES: readonly NoteVisibility[] = [
  'public',
  'home',
  'followers',
  'specified',
] as const

const ACCOUNT_ID_PARAM_DESC =
  'どのアカウントの下書きを操作するか。未指定なら active アカウント。' +
  ' 別サーバーのカラムから操作するときは `<currentColumn>.accountId` を渡す。'

function resolveAccountId(input: unknown): string {
  const explicit = typeof input === 'string' ? input.trim() : ''
  if (explicit) return explicit
  const store = useAccountsStore()
  const id = store.activeAccountId
  if (!id) throw new Error('drafts: no active account')
  return id
}

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  return v.length > 0 ? v : undefined
}

function ensureVisibility(v: unknown): NoteVisibility {
  if (
    typeof v === 'string' &&
    VALID_VISIBILITIES.includes(v as NoteVisibility)
  ) {
    return v as NoteVisibility
  }
  return 'public'
}

/** AI に返す projection。サーバー由来 id / text / visibility / 時刻 + 主要 context のみ。 */
function projectDraft(d: StoredDraft) {
  return {
    id: d.id,
    updatedAt: d.updatedAt,
    text: d.data.text,
    cw: d.data.cw || null,
    visibility: d.data.visibility,
    replyId: d.replyId,
    renoteId: d.renoteId,
    channelId: d.channelId,
    hashtag: d.hashtag,
    scheduledAt: d.data.scheduledAt,
    isActuallyScheduled: d.data.isActuallyScheduled ?? false,
  }
}

function emptyDraftData(): DraftData {
  return {
    text: '',
    cw: '',
    showCw: false,
    visibility: 'public',
    localOnly: false,
    fileIds: [],
    pollChoices: ['', ''],
    pollMultiple: false,
    showPoll: false,
    scheduledAt: null,
    isActuallyScheduled: false,
  }
}

export const draftsListCapability: Command = {
  id: 'drafts.list',
  label: '下書き一覧',
  icon: 'ti-note',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['drafts.read'],
  signature: {
    description:
      'アカウントの下書きを一覧取得する (Misskey 2025.6+ サーバー保存)。' +
      ' 別サーバーから取得するときは accountId を指定する。',
    params: {
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description:
        '下書きの配列 (id / text / visibility / replyId 等の projection)',
    },
  },
  visible: false,
  execute: async (params) => {
    const accountId = resolveAccountId(params?.accountId)
    await refreshDrafts(accountId)
    const all = loadAllDrafts(accountId)
    return Object.values(all).map(projectDraft)
  },
}

export const draftsCreateCapability: Command = {
  id: 'drafts.create',
  label: '下書きを作成',
  icon: 'ti-edit',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['drafts.write'],
  requiresConfirmation: true,
  signature: {
    description:
      '新規下書きを作成する。投稿はされず、サーバーに下書きとして保存される。' +
      ' text 必須。scheduledAt + isActuallyScheduled で予約投稿としても保存可能。',
    params: {
      text: { type: 'string', description: '下書き本文 (空文字は不可)' },
      cw: {
        type: 'string',
        description: 'CW (内容警告)',
        optional: true,
      },
      visibility: {
        type: 'string',
        description: '公開範囲 (default: public)',
        enum: VALID_VISIBILITIES,
        optional: true,
      },
      replyId: {
        type: 'string',
        description: 'リプライ先 noteId',
        optional: true,
      },
      renoteId: {
        type: 'string',
        description: '引用 / リノート対象 noteId',
        optional: true,
      },
      channelId: {
        type: 'string',
        description: 'チャンネル投稿先 id',
        optional: true,
      },
      scheduledAt: {
        type: 'string',
        description: 'ISO8601 形式の予約日時 (省略時は通常下書き)',
        optional: true,
      },
      isActuallyScheduled: {
        type: 'boolean',
        description:
          'true で「時刻到来時に自動投稿」(Misskey 2025.10+)。default false',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '作成された下書き projection',
    },
  },
  visible: false,
  execute: async (params) => {
    const text = pickString(params?.text)
    if (!text) throw new Error('drafts.create: text is required')
    const accountId = resolveAccountId(params?.accountId)
    const data = emptyDraftData()
    data.text = text
    const cw = pickString(params?.cw)
    if (cw) {
      data.cw = cw
      data.showCw = true
    }
    data.visibility = ensureVisibility(params?.visibility)
    const scheduledAt = pickString(params?.scheduledAt)
    if (scheduledAt) data.scheduledAt = scheduledAt
    if (params?.isActuallyScheduled === true) {
      data.isActuallyScheduled = true
    }
    const stored = await saveDraft(accountId, null, data, {
      replyId: pickString(params?.replyId) ?? null,
      renoteId: pickString(params?.renoteId) ?? null,
      channelId: pickString(params?.channelId) ?? null,
    })
    return projectDraft(stored)
  },
}

export const draftsUpdateCapability: Command = {
  id: 'drafts.update',
  label: '下書きを更新',
  icon: 'ti-edit',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['drafts.write'],
  requiresConfirmation: true,
  signature: {
    description:
      '既存下書きを更新する。指定したフィールドだけ差し替え、他は現在値を維持。' +
      ' draftId は drafts.list で取得した id を渡す。',
    params: {
      draftId: { type: 'string', description: '対象 draftId' },
      text: { type: 'string', description: '新しい本文', optional: true },
      cw: {
        type: 'string',
        description: '新しい CW (空文字で CW 解除)',
        optional: true,
      },
      visibility: {
        type: 'string',
        description: '公開範囲',
        enum: VALID_VISIBILITIES,
        optional: true,
      },
      scheduledAt: {
        type: 'string',
        description: 'ISO8601 予約日時 (空文字で予約解除)',
        optional: true,
      },
      isActuallyScheduled: {
        type: 'boolean',
        description: '自動投稿フラグの切替',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '更新後の下書き projection',
    },
  },
  visible: false,
  execute: async (params) => {
    const draftId = pickString(params?.draftId)
    if (!draftId) throw new Error('drafts.update: draftId is required')
    const accountId = resolveAccountId(params?.accountId)
    // 現在値を取得 (cache miss なら fetch して埋める)
    let cached = loadAllDrafts(accountId)[draftId]
    if (!cached) {
      await refreshDrafts(accountId)
      cached = loadAllDrafts(accountId)[draftId]
    }
    if (!cached) {
      throw new Error(`drafts.update: draft "${draftId}" not found`)
    }
    const data: DraftData = { ...cached.data }
    if (typeof params?.text === 'string') data.text = params.text
    if (typeof params?.cw === 'string') {
      data.cw = params.cw
      data.showCw = params.cw.length > 0
    }
    if (typeof params?.visibility === 'string') {
      data.visibility = ensureVisibility(params.visibility)
    }
    if (typeof params?.scheduledAt === 'string') {
      data.scheduledAt = params.scheduledAt || null
    }
    if (typeof params?.isActuallyScheduled === 'boolean') {
      data.isActuallyScheduled = params.isActuallyScheduled
    }
    const stored = await saveDraft(accountId, draftId, data, {
      replyId: cached.replyId,
      renoteId: cached.renoteId,
      channelId: cached.channelId,
      hashtag: cached.hashtag,
    })
    return projectDraft(stored)
  },
}

export const draftsDeleteCapability: Command = {
  id: 'drafts.delete',
  label: '下書きを削除',
  icon: 'ti-trash',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['drafts.write'],
  requiresConfirmation: (params) => {
    const draftId = typeof params?.draftId === 'string' ? params.draftId : ''
    return {
      title: '下書きを削除',
      message: `下書き ${draftId} を削除します。この操作は元に戻せません。`,
      okLabel: '削除',
      cancelLabel: 'やめる',
      type: 'danger',
    }
  },
  signature: {
    description: '指定 draftId の下書きを削除する。元に戻せない。',
    params: {
      draftId: { type: 'string', description: '対象 draftId' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ deleted: true, draftId }',
    },
  },
  visible: false,
  execute: async (params) => {
    const draftId = pickString(params?.draftId)
    if (!draftId) throw new Error('drafts.delete: draftId is required')
    const accountId = resolveAccountId(params?.accountId)
    await deleteDraft(accountId, draftId)
    return { deleted: true, draftId }
  },
}

export const DRAFTS_BUILTIN_CAPABILITIES: readonly Command[] = [
  draftsListCapability,
  draftsCreateCapability,
  draftsUpdateCapability,
  draftsDeleteCapability,
]

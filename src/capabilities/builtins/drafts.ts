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
import { resolveAccountId } from '../accountContext'
import { implement } from '../declare'

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

export const draftsListCapability = implement('drafts.list', {
  execute: async (params, ctx) => {
    const accountId = resolveAccountId(params?.accountId, ctx)
    await refreshDrafts(accountId)
    const all = loadAllDrafts(accountId)
    return Object.values(all).map(projectDraft)
  },
})

export const draftsCreateCapability = implement('drafts.create', {
  execute: async (params, ctx) => {
    const text = pickString(params?.text)
    if (!text) throw new Error('drafts.create: text is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
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
})

export const draftsUpdateCapability = implement('drafts.update', {
  execute: async (params, ctx) => {
    const draftId = pickString(params?.draftId)
    if (!draftId) throw new Error('drafts.update: draftId is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
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
})

export const draftsDeleteCapability = implement('drafts.delete', {
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
  execute: async (params, ctx) => {
    const draftId = pickString(params?.draftId)
    if (!draftId) throw new Error('drafts.delete: draftId is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
    await deleteDraft(accountId, draftId)
    return { deleted: true, draftId }
  },
})

export const DRAFTS_BUILTIN_CAPABILITIES: readonly Command[] = [
  draftsListCapability,
  draftsCreateCapability,
  draftsUpdateCapability,
  draftsDeleteCapability,
]

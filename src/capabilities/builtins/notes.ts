import type { NormalizedNote, TimelineType } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

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

/** `notes.search` — Misskey の /notes/search 経由でキーワード検索 */
export const notesSearchCapability = implement('notes.search', {
  execute: async (params, ctx) => {
    const query = typeof params?.query === 'string' ? params.query.trim() : ''
    if (!query) throw new Error('notes.search: query is required')
    const limit = clampLimit(params?.limit)
    const untilId = pickUntilId(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.searchNotes(query, { limit, untilId })
    return projectVisibleItems(notes, 'search', limit)
  },
})

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
export const notesSearchArchiveCapability = implement('notes.searchArchive', {
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
})

/** `notes.timeline` — home / local / social / global タイムライン取得 */
export const notesTimelineCapability = implement('notes.timeline', {
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
})

/** `notes.user` — 特定ユーザーの最近のノート取得 */
export const notesUserCapability = implement('notes.user', {
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
})

/** `notes.show` — 単一ノートを ID で取得 */
export const notesShowCapability = implement('notes.show', {
  execute: async (params, ctx) => {
    const noteId =
      typeof params?.noteId === 'string' ? params.noteId.trim() : ''
    if (!noteId) throw new Error('notes.show: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    const note = await api.getNote(noteId)
    // 配列を経由するが結果は 1 件目を返す (projection を再利用するため)
    return projectVisibleItems([note], 'search', 1)[0] ?? null
  },
})

/** `notes.children` — 指定ノートへのリプライ (子ノート) を取得 */
export const notesChildrenCapability = implement('notes.children', {
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
})

export const NOTES_BUILTIN_CAPABILITIES: readonly Command[] = [
  notesSearchCapability,
  notesSearchArchiveCapability,
  notesTimelineCapability,
  notesUserCapability,
  notesShowCapability,
  notesChildrenCapability,
]

import { ref } from 'vue'
import type { NoteVisibility } from '@/adapters/types'
import type { JsonValue, NoteDraft } from '@/bindings'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * Misskey `notes/drafts/*` (2025.6+) をアカウントごとのサーバー保存で扱う。
 * ローカル保存版はメモ機能 ({@link ./useMemos}) として別途残る。
 */
export interface DraftData {
  text: string
  cw: string
  showCw: boolean
  visibility: NoteVisibility
  localOnly: boolean
  fileIds: string[]
  pollChoices: string[]
  pollMultiple: boolean
  showPoll: boolean
  scheduledAt: string | null
  /**
   * Misskey 2025.10+ の予約投稿フラグ。`true` かつ `scheduledAt` 設定時に
   * サーバーが時刻到来で自動投稿する（下書き扱いではなくなる）。
   * 省略時は `false`（純粋な下書き）として扱う。
   */
  isActuallyScheduled?: boolean
}

export interface DraftContext {
  replyId?: string | null
  renoteId?: string | null
  channelId?: string | null
  hashtag?: string | null
}

export interface StoredDraft {
  /** サーバー側 draft id */
  id: string
  /** サーバー createdAt (ISO8601) */
  updatedAt: string
  data: DraftData
  replyId: string | null
  renoteId: string | null
  channelId: string | null
  hashtag: string | null
}

// accountId → draftId → StoredDraft
const cache: Record<string, Record<string, StoredDraft>> = {}
export const draftsVersion = ref(0)
export const draftsLoading = ref(false)

function toStored(raw: NoteDraft): StoredDraft {
  const pollChoices = raw.poll?.choices ?? []
  return {
    id: raw.id,
    updatedAt: raw.createdAt,
    data: {
      text: raw.text ?? '',
      cw: raw.cw ?? '',
      showCw: !!raw.cw,
      visibility: (raw.visibility as NoteVisibility) ?? 'public',
      localOnly: raw.localOnly ?? false,
      fileIds: raw.fileIds ?? [],
      pollChoices: pollChoices.length >= 2 ? pollChoices : ['', ''],
      pollMultiple: raw.poll?.multiple ?? false,
      showPoll: pollChoices.length >= 2,
      scheduledAt:
        raw.scheduledAt != null
          ? new Date(raw.scheduledAt).toISOString()
          : null,
      isActuallyScheduled: raw.isActuallyScheduled ?? false,
    },
    replyId: raw.replyId ?? null,
    renoteId: raw.renoteId ?? null,
    channelId: raw.channelId ?? null,
    hashtag: raw.hashtag ?? null,
  }
}

function buildParams(data: DraftData, ctx: DraftContext): JsonValue {
  const validChoices = data.showPoll
    ? data.pollChoices.filter((c) => c.trim())
    : []
  return {
    text: data.text || null,
    cw: data.showCw && data.cw ? data.cw : null,
    visibility: data.visibility,
    localOnly: data.localOnly,
    fileIds: data.fileIds,
    replyId: ctx.replyId ?? null,
    renoteId: ctx.renoteId ?? null,
    channelId: ctx.channelId ?? null,
    hashtag: ctx.hashtag ?? null,
    poll:
      validChoices.length >= 2
        ? { choices: validChoices, multiple: data.pollMultiple }
        : null,
    scheduledAt: data.scheduledAt ? new Date(data.scheduledAt).getTime() : null,
    isActuallyScheduled: data.isActuallyScheduled ?? false,
  }
}

export async function refreshDrafts(accountId: string): Promise<void> {
  draftsLoading.value = true
  try {
    const raw = unwrap(await commands.apiGetDrafts(accountId, { limit: 100 }))
    const map: Record<string, StoredDraft> = {}
    for (const entry of raw) {
      map[entry.id] = toStored(entry)
    }
    cache[accountId] = map
    draftsVersion.value++
  } catch (e) {
    // notes/drafts/* は Misskey 2025.6+。未対応サーバーは空扱い
    cache[accountId] = cache[accountId] ?? {}
    console.warn('[drafts] list failed:', AppError.from(e).message)
  } finally {
    draftsLoading.value = false
  }
}

export function loadAllDrafts(accountId: string): Record<string, StoredDraft> {
  return cache[accountId] ?? {}
}

export async function saveDraft(
  accountId: string,
  draftId: string | null,
  data: DraftData,
  ctx: DraftContext = {},
): Promise<StoredDraft> {
  const params = buildParams(data, ctx)
  let raw: NoteDraft
  if (draftId == null) {
    raw = unwrap(await commands.apiCreateDraft(accountId, params))
  } else {
    const updateParams: JsonValue = {
      ...(params as Partial<{ [k: string]: JsonValue }>),
      draftId,
    }
    raw = unwrap(await commands.apiUpdateDraft(accountId, updateParams))
  }
  const stored = toStored(raw)
  cache[accountId] = { ...(cache[accountId] ?? {}), [stored.id]: stored }
  draftsVersion.value++
  return stored
}

export async function deleteDraft(
  accountId: string,
  draftId: string,
): Promise<void> {
  try {
    unwrap(await commands.apiDeleteDraft(accountId, { draftId }))
  } catch (e) {
    // サーバー側で既に消えているケース (noSuchNoteDraft) はキャッシュ同期だけで良い
    if (AppError.from(e).apiCode !== 'NO_SUCH_NOTE_DRAFT') throw e
  }
  const existing = cache[accountId]
  if (existing && draftId in existing) {
    const next = { ...existing }
    delete next[draftId]
    cache[accountId] = next
    draftsVersion.value++
  }
}

export async function deleteAllDrafts(accountId: string): Promise<void> {
  const ids = Object.keys(cache[accountId] ?? {})
  if (ids.length === 0) return
  await Promise.allSettled(
    ids.map((id) => commands.apiDeleteDraft(accountId, { draftId: id })),
  )
  cache[accountId] = {}
  draftsVersion.value++
}

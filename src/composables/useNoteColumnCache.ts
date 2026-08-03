import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import type { QirQuery } from '@/bindings'
import { useNoteStore } from '@/stores/notes'
import { usePerformanceStore } from '@/stores/performance'
import { catchLog } from '@/utils/logger'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** Load cached notes from SQLite. */
export async function loadCachedTimeline(
  accountId: string,
  timelineType: string,
  limit?: number,
): Promise<NormalizedNote[]> {
  const effectiveLimit =
    limit ?? usePerformanceStore().get('cachedTimelineLimit')
  return unwrap(
    await commands.apiGetCachedTimeline(
      accountId,
      timelineType,
      effectiveLimit,
    ),
  ) as unknown as NormalizedNote[]
}

/** Load older cached notes before a given timestamp. */
export async function loadCachedTimelineBefore(
  accountId: string,
  timelineType: string,
  before: string,
  limit?: number,
): Promise<NormalizedNote[]> {
  const effectiveLimit =
    limit ?? usePerformanceStore().get('cachedTimelineLimit')
  return unwrap(
    await commands.apiGetCachedTimelineBefore(
      accountId,
      timelineType,
      before,
      effectiveLimit,
    ),
  ) as unknown as NormalizedNote[]
}

/**
 * Background-verify that cached notes still exist on the server.
 * Uses a single bulk IPC call to verify all notes in parallel on the Rust side.
 * Missing notes are purged from noteStore + DB cache; confirmed notes are refreshed.
 */
export async function purgeStaleCachedNotes(
  _adapter: ServerAdapter,
  idsToVerify: string[],
  isStillMounted: () => boolean,
  accountId: string,
): Promise<void> {
  if (idsToVerify.length === 0 || !isStillMounted()) return

  const noteStore = useNoteStore()
  try {
    const verified = unwrap(
      await commands.apiVerifyNotes(accountId, idsToVerify),
    ) as Record<string, NormalizedNote>

    if (!isStillMounted()) return

    const verifiedIds = new Set(Object.keys(verified))

    // Update confirmed notes with fresh data
    for (const [id, fresh] of Object.entries(verified)) {
      noteStore.update(id, fresh)
    }

    // Purge notes that no longer exist on the server.
    // verify-miss は heuristic（一時的 false-negative）なので tombstone しない。
    // 生きたノートをセッション中ずっと永久非表示にしてしまう false-positive を避ける。
    for (const id of idsToVerify) {
      if (!verifiedIds.has(id)) {
        noteStore.remove(id, false)
        commands.apiDeleteCachedNote(id).catch(catchLog('delete-cached-note'))
      }
    }
  } catch {
    // Bulk verify failed — silently ignore (notes stay cached)
  }
}

/**
 * カラムクエリでローカルキャッシュを検索する (#783 Phase 3)。
 *
 * FTS5 で粗く絞ってから Rust の QIR 評価器で判定するので、条件に合うノートを
 * 見つけるまで遡れる。`before` より古い側を、走査上限まで読んで探す。
 *
 * タイムライン種別では絞らない。キャッシュの所属は 1 ノート 1 種別で後勝ち
 * 上書きなので、種別で絞ると本来あるはずのノートを取りこぼす (notecli#30 で
 * 実体と所属を分離する再設計が計画されている)。取りこぼしより、別種別の
 * ノートが混ざる方が気づけるため、絞らない側に倒している。
 */
export async function searchCachedNotesByQuery(
  accountId: string,
  query: QirQuery,
  before: { createdAt: string; noteId: string } | null,
  limit: number,
  maxScannedRows: number,
): Promise<{
  notes: NormalizedNote[]
  errors: number
  /** 走査上限で打ち切った位置。null なら読み切っている */
  cursor: { createdAt: string; noteId: string } | null
}> {
  const result = unwrap(
    await commands.qirSearchCache(
      accountId,
      query,
      limit,
      maxScannedRows,
      before,
    ),
  )
  return {
    notes: result.notes as unknown as NormalizedNote[],
    errors: result.errors,
    cursor: result.cursor,
  }
}

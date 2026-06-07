import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
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

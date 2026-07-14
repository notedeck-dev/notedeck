import type { NormalizedNote } from '@/adapters/types'
import { useNoteStore } from '@/stores/notes'
import { usePerformanceStore } from '@/stores/performance'

export interface ScrollAnchor {
  /** 先頭可視アイテムの note id */
  id: string
  /** そのアイテム上端からのピクセルオフセット */
  offset: number
}

interface Snapshot {
  noteIds: string[]
  scrollTop: number
  /** 仮想スクローラの再測定に強いアンカー。あれば scrollTop より優先して復元 */
  anchor: ScrollAnchor | null
  savedAt: number
}

export interface ResolvedSnapshot {
  notes: NormalizedNote[]
  scrollTop: number
  anchor: ScrollAnchor | null
}

const store = new Map<string, Snapshot>()

function key(columnId: string, cacheKey: string): string {
  return `${columnId}:${cacheKey}`
}

function evictExpired(): void {
  const ttl = usePerformanceStore().get('snapshotTTL') * 60_000
  const now = Date.now()
  for (const [k, snap] of store) {
    if (now - snap.savedAt >= ttl) store.delete(k)
  }
}

function resolveSnapshot(snap: Snapshot): ResolvedSnapshot | null {
  const notes = useNoteStore().resolve(snap.noteIds)
  if (notes.length === 0) return null
  return { notes, scrollTop: snap.scrollTop, anchor: snap.anchor }
}

/**
 * Save note IDs + scroll position for instant restore.
 * `noteIds` は表示述語でフィルタしない「列のメンバーシップ」(orderedIds) を渡すこと。
 * フィルタ後の表示リストを渡すと、ミュート等の可視性状態が snapshot に焼き込まれ、
 * 解除しても復活できなくなる（#574）。可視性は復帰後に述語で再適用される。
 */
export function save(
  columnId: string,
  cacheKey: string,
  noteIds: string[],
  scrollTop: number,
  anchor: ScrollAnchor | null = null,
): void {
  const maxNotes = usePerformanceStore().get('snapshotMaxNotes')
  evictExpired()
  store.set(key(columnId, cacheKey), {
    noteIds: noteIds.slice(0, maxNotes),
    scrollTop,
    anchor,
    savedAt: Date.now(),
  })
}

/** Restore a snapshot without consuming it (for tab switching). */
export function restore(
  columnId: string,
  cacheKey: string,
): ResolvedSnapshot | null {
  const ttl = usePerformanceStore().get('snapshotTTL') * 60_000
  const snap = store.get(key(columnId, cacheKey))
  if (snap && Date.now() - snap.savedAt < ttl) return resolveSnapshot(snap)
  return null
}

/** Restore and consume a snapshot (for column re-mount). */
export function restoreAndConsume(
  columnId: string,
  cacheKey: string,
): ResolvedSnapshot | null {
  const k = key(columnId, cacheKey)
  const ttl = usePerformanceStore().get('snapshotTTL') * 60_000
  const snap = store.get(k)
  store.delete(k)
  if (snap && Date.now() - snap.savedAt < ttl) return resolveSnapshot(snap)
  return null
}

/** Remove all snapshots for a column (e.g. column deletion). */
export function evictColumn(columnId: string): void {
  const prefix = `${columnId}:`
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}

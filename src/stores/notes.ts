import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import type { NormalizedNote, NoteUpdateEvent } from '@/adapters/types'
import { useFrameScheduler } from '@/composables/useFrameScheduler'
import { evictByLiveness } from '@/services/mapEviction'
import {
  createUpdateDeduper,
  mergeNoteUpdate,
  noteUpdateSig,
} from '@/services/streamUpdateMerge'
import { usePerformanceStore } from '@/stores/performance'

/** Window for dropping duplicate noteUpdated events (channel + note capture から
 *  同一イベントが二重に来る場合の対策). 1.5s なら同じユーザの逐次操作 (react→unreact)
 *  は別 sig で別個に通る。 */
const NOTE_UPDATE_DEDUP_WINDOW_MS = 1500

export const useNoteStore = defineStore('notes', () => {
  const perfStore = usePerformanceStore()
  const { schedule } = useFrameScheduler()
  const noteMap = shallowRef(new Map<string, NormalizedNote>())
  const deleteListeners = new Set<(id: string) => void>()
  /**
   * 削除済みノートの tombstone（セッション揮発）。SQLite 再読込で復活した
   * 削除済みノートを表示述語 isDeleted で握り潰すため（#602）。表示述語の
   * 素材その1で、将来 muted/archived と OR 合成する拡張点（合成は consumption 層）。
   */
  const deletedIds = new Set<string>()
  /** Dedup of the same update arriving via multiple delivery paths. */
  const updateDeduper = createUpdateDeduper(NOTE_UPDATE_DEDUP_WINDOW_MS)
  /**
   * 現在どのカラムからも参照されている ID 集合を供給する root 群。
   * 退避時に「どの root にも含まれない」ノートを優先削除し、アクティブカラムの
   * 表示継続性を保つ。各カラムは useNoteList でセットを登録／解除する。
   */
  const roots = new Set<() => Iterable<string>>()

  /** Batch triggerRef calls into one per animation frame (streaming events fire rapidly) */
  let triggerScheduled = false
  const doTrigger = () => {
    triggerScheduled = false
    triggerRef(noteMap)
  }

  function scheduleTrigger() {
    if (triggerScheduled) return
    triggerScheduled = true
    schedule(doTrigger, 'normal')
  }

  /**
   * root を登録。戻り値の関数で解除する。
   * useNoteList がカラムの可視ID集合を登録することで、退避時に
   * アクティブカラム表示中のノートが優先的に保護される。
   */
  function registerRoot(provider: () => Iterable<string>): () => void {
    roots.add(provider)
    return () => {
      roots.delete(provider)
    }
  }

  /** すべての root に含まれる ID の和集合を返す */
  function collectLiveIds(): Set<string> {
    const live = new Set<string>()
    for (const provider of roots) {
      for (const id of provider()) live.add(id)
    }
    return live
  }

  /**
   * 退避戦略:
   *   1) どの root からも参照されていないノートを古い順に削除
   *   2) それでも上限を超えるなら LRU フォールバック（古い順に削除）
   */
  function evictIfNeeded() {
    const map = noteMap.value
    const max = perfStore.get('noteStoreMax')
    if (map.size <= max) return

    const live = collectLiveIds()
    // renote 参照ノートも生存扱い（resolve() で辿られる）
    if (live.size > 0) {
      for (const id of live) {
        const note = map.get(id)
        if (note?.renoteId) live.add(note.renoteId)
      }
    }

    evictByLiveness(
      map,
      max,
      live,
      (note) => note.createdAt,
      (note) => note.id,
    )
  }

  /**
   * Insert notes into the global store.
   * @param skipTrigger - When true, skip scheduling triggerRef. Use this when
   *   the caller already drives reactivity via its own ref (e.g. orderedIds in useNoteList).
   */
  function put(notes: NormalizedNote[], skipTrigger = false) {
    const map = noteMap.value
    // First pass: insert all notes and renotes.
    // LRU refresh on access is handled by get(); put() preserves arrival order
    // so hot streaming paths avoid a redundant delete op per note.
    for (const note of notes) {
      map.set(note.id, note)
      if (note.renote) map.set(note.renote.id, note.renote)
    }
    // Second pass: eagerly sync renote references so resolve() avoids spread
    for (const note of notes) {
      if (note.renoteId) {
        const latest = map.get(note.renoteId)
        if (latest && note.renote !== latest) {
          note.renote = latest
        }
      }
    }
    evictIfNeeded()
    if (!skipTrigger) scheduleTrigger()
  }

  function get(id: string): NormalizedNote | undefined {
    const map = noteMap.value
    const note = map.get(id)
    // Refresh insertion order so recently accessed notes survive FIFO eviction
    if (note) {
      map.delete(id)
      map.set(id, note)
    }
    return note
  }

  /** Resolve an ordered list of IDs into NormalizedNote[], with latest renote from store.
   *  Pure function — does not mutate the Map (renote syncing is handled eagerly in put()). */
  function resolve(ids: string[]): NormalizedNote[] {
    const map = noteMap.value
    const result: NormalizedNote[] = []
    for (const id of ids) {
      const note = map.get(id)
      if (!note) continue
      // Return a fresh object when renote reference is stale so Vue detects the prop update.
      // No Map mutation — keeps this function safe for use inside computed getters.
      if (note.renoteId) {
        const renote = map.get(note.renoteId)
        if (renote && renote !== note.renote) {
          result.push({ ...note, renote })
          continue
        }
      }
      result.push(note)
    }
    return result
  }

  /**
   * ノートを削除する。
   * @param tombstone - true（既定）で deletedIds に記録し、再読込での復活を
   *   表示述語が抑止する。背景検証の verify-miss は heuristic（一時的 false-negative
   *   で生きたノートを永久に隠す危険）なので false を渡して tombstone しない。
   */
  function remove(id: string, tombstone = true) {
    if (tombstone) deletedIds.add(id)
    noteMap.value.delete(id)
    scheduleTrigger()
    for (const listener of deleteListeners) listener(id)
  }

  /** ノートが削除済み tombstone かを返す。表示述語の素材（#602）。 */
  function isDeleted(id: string): boolean {
    return deletedIds.has(id)
  }

  function onDelete(listener: (id: string) => void): () => void {
    deleteListeners.add(listener)
    return () => deleteListeners.delete(listener)
  }

  function applyUpdate(event: NoteUpdateEvent, myUserId: string | undefined) {
    if (event.type === 'deleted') {
      // delete は idempotent なので dedup 不要
      remove(event.noteId)
      return
    }

    // Channel auto-capture と subNote の両経路から同じ noteUpdated が
    // 来うるため (例: 共通 timeline 購読中の note を別途 subNote 中の場合)、
    // 短い窓で同一 sig の重複を弾く。userId / reaction / choice まで含める
    // ので「同ユーザの逐次 react→unreact」は別 sig として通る。
    if (!updateDeduper.shouldApply(event.noteId, noteUpdateSig(event))) return

    const note = noteMap.value.get(event.noteId)
    if (!note) return

    const merged = mergeNoteUpdate(note, event, myUserId)
    if (!merged) return
    noteMap.value.set(event.noteId, merged)
    scheduleTrigger()
  }

  /** Update a single note in the store (batched trigger for streaming perf) */
  function update(id: string, note: NormalizedNote) {
    noteMap.value.set(id, note)
    scheduleTrigger()
  }

  /** Trigger reactivity after direct note mutation (e.g. toggleReaction) */
  function notifyMutation() {
    scheduleTrigger()
  }

  return {
    noteMap,
    put,
    get,
    resolve,
    update,
    remove,
    isDeleted,
    onDelete,
    applyUpdate,
    notifyMutation,
    registerRoot,
  }
})

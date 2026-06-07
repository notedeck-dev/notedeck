import { computed, onScopeDispose, shallowRef } from 'vue'
import type {
  NormalizedNote,
  NoteUpdateEvent,
  ServerAdapter,
} from '@/adapters/types'
import { useNoteStore } from '@/stores/notes'
import { usePerformanceStore } from '@/stores/performance'
import { insertIntoSorted } from '@/utils/sortNotes'
import { commands } from '@/utils/tauriInvoke'
import { useNoteVisibility } from './useNoteVisibility'

/** @deprecated Use usePerformanceStore().get('noteListMax') instead. Kept for test compatibility. */
export const NOTE_LIST_MAX = 200

export interface UseNoteListOptions {
  getMyUserId: () => string | undefined
  getAdapter: () => ServerAdapter | null
  deleteHandler: (note: NormalizedNote) => Promise<boolean>
  closePostForm: () => void
  onNotesChanged?: (notes: NormalizedNote[]) => void
  maxNotes?: number
}

export function useNoteList(options: UseNoteListOptions) {
  const noteStore = useNoteStore()
  const visibility = useNoteVisibility()
  const perfStore = usePerformanceStore()
  const maxNotes = options.maxNotes ?? perfStore.get('noteListMax')
  const orderedIds = shallowRef<string[]>([])
  const noteIds = new Set<string>()
  let onNotesChangedFn = options.onNotesChanged

  // Listen for global note deletions so ALL columns clean up their orderedIds
  const unsubDelete = noteStore.onDelete((id) => {
    if (noteIds.has(id)) {
      orderedIds.value = orderedIds.value.filter((oid) => oid !== id)
      noteIds.delete(id)
    }
  })
  onScopeDispose(unsubDelete)

  // カラムの表示中 ID を noteStore に root として登録。退避時に保護される。
  const unregisterRoot = noteStore.registerRoot(() => noteIds)
  onScopeDispose(unregisterRoot)

  const notes = computed({
    // 削除済みノートはキャッシュ再読込で noteMap/orderedIds に復活しうるため、
    // 表示時の可視性述語で除外する（#602）。muted/archived の合成もこの述語に集約。
    get: () =>
      noteStore
        .resolve(orderedIds.value)
        .filter((n) => !visibility.isHidden(n)),
    set: (newNotes: NormalizedNote[]) => {
      const trimmed =
        newNotes.length > maxNotes ? newNotes.slice(0, maxNotes) : newNotes
      // skipTrigger: orderedIds assignment below already drives this column's reactivity.
      // A global triggerRef would redundantly invalidate ALL columns' notes computeds.
      noteStore.put(trimmed, true)
      const ids: string[] = new Array(trimmed.length)
      noteIds.clear()
      for (let i = 0; i < trimmed.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: bounded loop
        const id = trimmed[i]!.id
        ids[i] = id
        noteIds.add(id)
      }
      orderedIds.value = ids
    },
  })

  function setOnNotesChanged(fn: (notes: NormalizedNote[]) => void) {
    onNotesChangedFn = fn
  }

  function setNotes(newNotes: NormalizedNote[]) {
    notes.value = newNotes
    // Pass the trimmed result (setter may have truncated)
    onNotesChangedFn?.(notes.value)
  }

  /**
   * Incrementally merge fetched notes into the current list.
   * - Notes already displayed are updated in-place (no list re-render).
   * - Genuinely new notes are inserted in sorted order.
   */
  function mergeUpdate(newNotes: NormalizedNote[]): void {
    const existing = newNotes.filter((n) => noteIds.has(n.id))
    const brandNew = newNotes.filter((n) => !noteIds.has(n.id))
    if (existing.length > 0) noteStore.put(existing)
    if (brandNew.length > 0) setNotes(insertIntoSorted(notes.value, brandNew))
  }

  function onNoteUpdate(event: NoteUpdateEvent) {
    if (event.type === 'deleted') {
      // noteStore.remove() triggers global onDelete listeners,
      // which clean up orderedIds/noteIds in ALL columns
      noteStore.remove(event.noteId)
      commands.apiDeleteCachedNote(event.noteId).catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[delete-cached-note] ignored:', e)
      })
      return
    }
    noteStore.applyUpdate(event, options.getMyUserId())
  }

  async function handlePosted(editedNoteId?: string) {
    options.closePostForm()
    if (editedNoteId) {
      const adapter = options.getAdapter()
      if (!adapter) return
      try {
        const updated = await adapter.api.getNote(editedNoteId)
        noteStore.put([updated])
      } catch (e) {
        // note may have been deleted
        if (import.meta.env.DEV)
          console.debug('[handlePosted] note fetch failed:', e)
      }
    }
  }

  async function removeNote(note: NormalizedNote) {
    const id = note.id
    const prevIds = orderedIds.value
    notes.value = notes.value.filter((n) => n.id !== id && n.renoteId !== id)

    if (await options.deleteHandler(note)) {
      noteStore.remove(id)
      commands.apiDeleteCachedNote(id).catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[delete-cached-note] ignored:', e)
      })
    } else {
      orderedIds.value = prevIds
      noteIds.clear()
      for (const nid of prevIds) noteIds.add(nid)
    }
  }

  return {
    notes,
    // 表示述語でフィルタされない「列のメンバーシップ」。snapshot 保存はこれを使う
    // ことで、ミュート等の可視性状態を焼き込まず、解除で復活できる（#574）。
    orderedIds,
    noteIds,
    setNotes,
    mergeUpdate,
    setOnNotesChanged,
    onNoteUpdate,
    handlePosted,
    removeNote,
  }
}

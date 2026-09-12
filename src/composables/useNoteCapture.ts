import { onUnmounted } from 'vue'
import type {
  NormalizedNote,
  NoteUpdateEvent,
  StreamAdapter,
} from '@/adapters/types'
import { usePerformanceStore } from '@/stores/performance'

/**
 * Subscribes displayed notes to Misskey's Note Capture mechanism (subNote/unsubNote)
 * so that reactions, poll votes, and deletions are received in real-time.
 *
 * Used by ALL note columns — including streaming ones — to ensure reaction
 * freshness even when the timeline channel subscription is suspended (off-screen
 * >8s). Channel auto-capture and per-note capture can fire the same noteUpdated
 * event; `noteStore.applyUpdate` dedupes by (type × userId × reaction × choice)
 * within a 1.5s window.
 *
 * Call `sync(notes)` explicitly when notes are added/removed (connect, loadMore,
 * onResume). Do NOT call on reaction/poll updates — those don't change
 * the set of captured note IDs.
 */
export function useNoteCapture(
  getStream: () => StreamAdapter | undefined,
  onUpdate: (event: NoteUpdateEvent) => void,
) {
  const perfStore = usePerformanceStore()
  const capturedIds = new Set<string>()

  function sync(notes: NormalizedNote[]) {
    const stream = getStream()
    if (!stream) return

    const capped = notes.slice(0, perfStore.get('noteCaptureMax'))
    const currentIds = new Set<string>()
    for (const note of capped) {
      currentIds.add(note.id)
      if (note.renoteId) currentIds.add(note.renoteId)
    }

    // Subscribe new notes
    for (const id of currentIds) {
      if (!capturedIds.has(id)) {
        capturedIds.add(id)
        stream.subNote(id, onUpdate)
      }
    }

    // Unsubscribe removed notes (scrolled past MAX_CAPTURE or deleted)
    for (const id of capturedIds) {
      if (!currentIds.has(id)) {
        capturedIds.delete(id)
        stream.unsubNote(id, onUpdate)
      }
    }
  }

  function cleanup() {
    const stream = getStream()
    if (stream) {
      for (const id of capturedIds) {
        stream.unsubNote(id, onUpdate)
      }
    }
    capturedIds.clear()
  }

  onUnmounted(cleanup)

  return { sync, cleanup }
}

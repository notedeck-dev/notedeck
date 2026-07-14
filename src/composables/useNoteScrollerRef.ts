import { type Ref, ref, watch } from 'vue'

export interface NoteScrollerExpose {
  getElement: () => HTMLElement | null
  scrollToIndex: (
    index: number,
    opts?: { align?: string; behavior?: string },
  ) => void
  getScrollAnchor: () => { id: string; offset: number } | null
  restoreScrollAnchor: (id: string, offset: number) => boolean
}

/**
 * Create a template ref for NoteScroller and sync its scroll container
 * to the given scroller ref (used by useColumnSetup for scroll tracking).
 */
export function useNoteScrollerRef(scroller: Ref<HTMLElement | null>) {
  const noteScrollerRef = ref<NoteScrollerExpose | null>(null)
  watch(
    noteScrollerRef,
    () => {
      scroller.value = noteScrollerRef.value?.getElement() ?? null
    },
    { flush: 'post' },
  )
  return { noteScrollerRef }
}

import type { ShallowRef } from 'vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { usePinnedReactionsStore } from '@/stores/pinnedReactions'
import { useToast } from '@/stores/toast'

export type NoteAction =
  | 'next'
  | 'prev'
  | 'reply'
  | 'react'
  | 'renote'
  | 'quote'
  | 'bookmark'
  | 'open'
  | 'toggle-cw'
  | 'delete'
  | 'edit'
  | 'copy-link'
  | 'copy-content'
  | `quick-react-${number}`

export interface NoteActionHandlers {
  reply: (note: NormalizedNote) => void
  reaction: (reaction: string, note: NormalizedNote) => void
  renote: (note: NormalizedNote) => void
  quote: (note: NormalizedNote) => void
  bookmark: (note: NormalizedNote) => void
  delete?: (note: NormalizedNote) => void
  edit?: (note: NormalizedNote) => void
}

function scrollTo(
  scroller: ShallowRef<HTMLElement | null>,
  index: number,
  scrollToIndexFn?: (index: number) => void,
) {
  if (scrollToIndexFn) {
    scrollToIndexFn(index)
    return
  }
  // Fallback for non-virtualized contexts
  const el = scroller.value
  if (!el) return
  const item = el.querySelector(`[data-index="${index}"]`) as HTMLElement | null
  item?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

export function useNoteFocus(
  columnId: string,
  notes: ShallowRef<NormalizedNote[]>,
  scroller: ShallowRef<HTMLElement | null>,
  handlers: NoteActionHandlers,
  onOpen?: (note: NormalizedNote) => void,
  accountId?: string,
  /** Virtualizer scroll callback — when provided, used instead of querySelector-based scrolling */
  scrollToIndex?: (index: number) => void,
) {
  const deckStore = useDeckStore()
  const pinnedReactionsStore = usePinnedReactionsStore()
  const focusedIndex = ref(-1)

  const focusedNoteId = computed<string | undefined>(() => {
    const idx = focusedIndex.value
    if (idx < 0 || idx >= notes.value.length) return undefined
    return notes.value[idx]?.id ?? undefined
  })

  // capability `column.focusedNote` から横断で読めるよう deck store に反映
  watch(focusedNoteId, (id) => {
    deckStore.setFocusedNoteId(columnId, id ?? null)
  })

  const isActive = computed(() => deckStore.activeColumnId === columnId)

  function getFocusedNote(): NormalizedNote | null {
    const idx = focusedIndex.value
    if (idx < 0 || idx >= notes.value.length) return null
    return notes.value[idx] ?? null
  }

  function focusNext() {
    if (notes.value.length === 0) return
    const next = Math.min(focusedIndex.value + 1, notes.value.length - 1)
    focusedIndex.value = next
    scrollTo(scroller, next, scrollToIndex)
  }

  function focusPrev() {
    if (notes.value.length === 0) return
    if (focusedIndex.value <= 0) {
      focusedIndex.value = -1
      scrollTo(scroller, 0, scrollToIndex)
      return
    }
    focusedIndex.value -= 1
    scrollTo(scroller, focusedIndex.value, scrollToIndex)
  }

  function clearFocus() {
    focusedIndex.value = -1
  }

  function handleAction(e: Event) {
    if (!isActive.value) return
    const action = (e as CustomEvent<NoteAction>).detail
    switch (action) {
      case 'next':
        focusNext()
        break
      case 'prev':
        focusPrev()
        break
      case 'reply': {
        const note = getFocusedNote()
        if (note) handlers.reply(note)
        break
      }
      case 'react': {
        const note = getFocusedNote()
        if (note) {
          // Find the focused note DOM element and trigger the reaction picker
          const el = findFocusedNoteEl()
          if (el) {
            const btn = el.querySelector('.reaction-trigger') as HTMLElement
            btn?.click()
          }
        }
        break
      }
      case 'renote': {
        const note = getFocusedNote()
        if (note) handlers.renote(note)
        break
      }
      case 'quote': {
        const note = getFocusedNote()
        if (note) handlers.quote(note)
        break
      }
      case 'bookmark': {
        const note = getFocusedNote()
        if (note) handlers.bookmark(note)
        break
      }
      case 'open': {
        const note = getFocusedNote()
        if (note) onOpen?.(note)
        break
      }
      case 'toggle-cw': {
        const el = findFocusedNoteEl()
        if (el) {
          const btn = el.querySelector('.cw-toggle') as HTMLElement
          btn?.click()
        }
        break
      }
      case 'delete': {
        const note = getFocusedNote()
        if (!note || !handlers.delete) break
        const { confirm } = useConfirm()
        confirm({
          title: 'ノートを削除',
          message: 'このノートを削除しますか？',
          okLabel: '削除',
          type: 'danger',
        }).then((ok) => {
          if (ok) handlers.delete?.(note)
        })
        break
      }
      case 'edit': {
        const note = getFocusedNote()
        if (note) handlers.edit?.(note)
        break
      }
      case 'copy-link': {
        const note = getFocusedNote()
        if (note) {
          const url =
            note.url ??
            note.uri ??
            `https://${note._serverHost}/notes/${note.id}`
          navigator.clipboard.writeText(url).catch(() => undefined)
          useToast().show('リンクをコピーしました', 'info')
        }
        break
      }
      case 'copy-content': {
        const note = getFocusedNote()
        if (note?.text) {
          navigator.clipboard.writeText(note.text).catch(() => undefined)
          useToast().show('内容をコピーしました', 'info')
        }
        break
      }
      default: {
        // quick-react-1 ~ quick-react-9
        const m = action.match(/^quick-react-(\d)$/)
        if (m) {
          const note = getFocusedNote()
          if (!note) break
          const acctId = accountId ?? note._accountId
          if (!acctId) break
          const reactions = pinnedReactionsStore.get(acctId)
          const digit = m[1]
          if (!digit) break
          const idx = Number.parseInt(digit, 10) - 1
          const reaction = reactions[idx]
          if (reaction) handlers.reaction(reaction, note)
        }
        break
      }
    }
  }

  function findFocusedNoteEl(): HTMLElement | null {
    if (!scroller.value) return null
    return scroller.value.querySelector(
      `[data-index="${focusedIndex.value}"] .note-root`,
    )
  }

  // Reset focus when notes change significantly (e.g., timeline reconnect)
  watch(
    () => notes.value.length,
    (newLen, oldLen) => {
      if (newLen === 0 || (oldLen > 0 && newLen < oldLen / 2)) {
        clearFocus()
      }
    },
  )

  // Reset focus when column becomes inactive
  watch(isActive, (active) => {
    if (!active) clearFocus()
  })

  document.addEventListener('nd:note-action', handleAction)
  onUnmounted(() => {
    document.removeEventListener('nd:note-action', handleAction)
  })

  return {
    focusedIndex,
    focusedNoteId,
    clearFocus,
  }
}

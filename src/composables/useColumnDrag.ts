import { ref } from 'vue'
import type { useDeckStore } from '@/stores/deck'
import { hapticLight, hapticMedium } from '@/utils/haptics'
import { emitTauri } from '@/utils/tauriEvents'

type DeckStore = ReturnType<typeof useDeckStore>

const DRAG_THRESHOLD = 5

type DropTarget =
  | { columnId: string; position: 'swap' | 'above' | 'below' }
  | { insertIndex: number; position: 'insert' }

export interface ColumnDragSelectors {
  columns: string
  columnSection: string
  colResizeHandle: string
}

export function useColumnDrag(
  deckStore: DeckStore,
  selectors: ColumnDragSelectors,
) {
  const dragColumnId = ref<string | null>(null)
  const dropTarget = ref<DropTarget | null>(null)

  let ghost: HTMLElement | null = null
  let ghostHalfWidth = 0

  // Pre-computed lookup: columnId → group index in layout (built once per drag)
  let groupIndexMap: Map<string, number> | null = null

  function buildGroupIndexMap() {
    const map = new Map<string, number>()
    for (let i = 0; i < deckStore.layout.length; i++) {
      const group = deckStore.layout[i]
      if (group) {
        for (const id of group) {
          map.set(id, i)
        }
      }
    }
    groupIndexMap = map
  }

  function startDrag(columnId: string, e: PointerEvent) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button')) return

    e.preventDefault()

    const sx = e.clientX
    const sy = e.clientY

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onCancel)
      beginDrag(columnId, ev)
    }

    function onCancel() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onCancel)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onCancel)
  }

  function beginDrag(columnId: string, e: PointerEvent) {
    hapticLight()
    dragColumnId.value = columnId
    buildGroupIndexMap()

    const sourceEl = document.querySelector(
      `.stack-cell[data-column-id="${CSS.escape(columnId)}"]`,
    )
    const header = sourceEl?.querySelector(
      '.column-header',
    ) as HTMLElement | null
    if (header) {
      ghost = header.cloneNode(true) as HTMLElement
      ghostHalfWidth = header.clientWidth / 2
      const prefersReduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches
      if (prefersReduced) {
        Object.assign(ghost.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          zIndex: '10000',
          pointerEvents: 'none',
          opacity: '0.85',
          width: `${header.clientWidth}px`,
          transform: 'scale(0.95)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          borderRadius: '8px',
          overflow: 'hidden',
        })
      } else {
        Object.assign(ghost.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          zIndex: '10000',
          pointerEvents: 'none',
          width: `${header.clientWidth}px`,
          borderRadius: '8px',
          overflow: 'hidden',
          opacity: '0',
          transform: 'scale(0.9) rotate(-1deg)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          transition:
            'opacity 0.2s ease-out, transform 0.3s cubic-bezier(0.34, 1.1, 0.64, 1)',
        })
      }
      document.body.appendChild(ghost)
      if (!prefersReduced) {
        requestAnimationFrame(() => {
          if (ghost) {
            ghost.style.opacity = '0.85'
            ghost.style.transform = 'scale(1.02) rotate(-1.5deg)'
          }
        })
      }
    }

    moveGhost(e.clientX, e.clientY)
    document.body.classList.add('nd-dragging')

    document.addEventListener('pointermove', onDragMove)
    document.addEventListener('pointerup', onDragEnd)
    document.documentElement.addEventListener('pointerleave', onPointerLeave)

    // Notify other windows about drag start
    emitDragEvent('deck:drag-start', columnId)
  }

  function moveGhost(x: number, y: number) {
    if (!ghost) return
    ghost.style.translate = `${x - ghostHalfWidth}px ${y - 10}px`
  }

  function onDragMove(e: PointerEvent) {
    moveGhost(e.clientX, e.clientY)

    // Hide ghost for hit detection
    if (ghost) ghost.style.display = 'none'
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (ghost) ghost.style.display = ''

    if (!el) {
      dropTarget.value = null
      return
    }

    // Check if hovering over a column
    const cell = el.closest('[data-column-id]') as HTMLElement | null
    if (cell) {
      const targetId = cell.dataset.columnId
      if (!targetId || targetId === dragColumnId.value) {
        dropTarget.value = null
        return
      }

      // Same group — only swap is meaningful (no nested stacking)
      const dragId = dragColumnId.value
      const sameGroup =
        dragId &&
        groupIndexMap != null &&
        groupIndexMap.get(dragId) === groupIndexMap.get(targetId)

      if (sameGroup) {
        dropTarget.value = { columnId: targetId, position: 'swap' }
      } else {
        const rect = cell.getBoundingClientRect()
        const relY = (e.clientY - rect.top) / rect.height

        let position: 'swap' | 'above' | 'below'
        if (relY < 0.25) {
          position = 'above'
        } else if (relY > 0.75) {
          position = 'below'
        } else {
          position = 'swap'
        }

        dropTarget.value = { columnId: targetId, position }
      }
      return
    }

    // Helper: inserting at fromIdx or fromIdx+1 is a no-op (same position)
    function isInsertNoop(insertIndex: number): boolean {
      const dragId = dragColumnId.value
      if (!dragId || !groupIndexMap) return false
      const fromIdx = groupIndexMap.get(dragId) ?? -1
      return (
        fromIdx >= 0 && (insertIndex === fromIdx || insertIndex === fromIdx + 1)
      )
    }

    // Check if hovering over a resize handle or gap between columns
    const handle = el.closest(
      `.${selectors.colResizeHandle}`,
    ) as HTMLElement | null
    if (handle) {
      const sections = [
        ...document.querySelectorAll(`.${selectors.columnSection}`),
      ] as HTMLElement[]
      const handleRect = handle.getBoundingClientRect()
      const handleCenter = handleRect.left + handleRect.width / 2

      // Find which section is to the left of this handle
      let insertIndex = sections.length
      for (let i = 0; i < sections.length; i++) {
        const sRect = sections[i]?.getBoundingClientRect()
        if (sRect && sRect.left > handleCenter) {
          insertIndex = i
          break
        }
      }

      dropTarget.value = isInsertNoop(insertIndex)
        ? null
        : { insertIndex, position: 'insert' }
      return
    }

    // Check if hovering over empty area within the columns container
    const columnsContainer = el.closest(
      `.${selectors.columns}`,
    ) as HTMLElement | null
    if (columnsContainer) {
      const sections = [
        ...columnsContainer.querySelectorAll(
          `:scope > .${selectors.columnSection}`,
        ),
      ] as HTMLElement[]

      // Determine insert position from cursor X
      let insertIndex = sections.length
      for (let i = 0; i < sections.length; i++) {
        const sRect = sections[i]?.getBoundingClientRect()
        if (sRect && e.clientX < sRect.left + sRect.width / 2) {
          insertIndex = i
          break
        }
      }

      dropTarget.value = isInsertNoop(insertIndex)
        ? null
        : { insertIndex, position: 'insert' }
      return
    }

    dropTarget.value = null
  }

  function cleanupDrag() {
    document.removeEventListener('pointermove', onDragMove)
    document.removeEventListener('pointerup', onDragEnd)
    document.documentElement.removeEventListener('pointerleave', onPointerLeave)

    dragColumnId.value = null
    dropTarget.value = null
    groupIndexMap = null
    if (ghost) {
      ghost.remove()
      ghost = null
    }
    ghostHalfWidth = 0
    document.body.classList.remove('nd-dragging')
  }

  function onDragEnd() {
    if (dropTarget.value && dragColumnId.value) {
      const dragId = dragColumnId.value

      if (dropTarget.value.position === 'insert') {
        // Drop between columns — unstack / move to position
        deckStore.insertColumnAt(dragId, dropTarget.value.insertIndex)
      } else {
        const { columnId: targetId, position } = dropTarget.value
        const fromIdx = deckStore.layout.findIndex((ids) =>
          ids.includes(dragId),
        )
        const toIdx = deckStore.layout.findIndex((ids) =>
          ids.includes(targetId),
        )

        if (position === 'swap') {
          if (fromIdx === toIdx && fromIdx >= 0) {
            // Same group — swap within group
            deckStore.swapInGroup(dragId, targetId)
          } else if (fromIdx >= 0 && toIdx >= 0) {
            // Different groups — swap entire groups
            deckStore.swapColumns(fromIdx, toIdx)
          }
        } else if (position === 'above' || position === 'below') {
          deckStore.stackColumn(dragId, targetId, position)
        }
      }
    }

    hapticMedium()

    // Notify other windows that drag ended
    emitDragEvent('deck:drag-end', dragColumnId.value)

    cleanupDrag()
  }

  /** When cursor leaves the window during a drag, end the local drag and let other windows handle it */
  function onPointerLeave() {
    if (!dragColumnId.value) return
    // Don't apply any drop — just clean up locally
    // The IPC deck:drag-start already notified other windows; they show the overlay
    // When user clicks the overlay in target window, requestMoveColumn handles the actual move
    emitDragEvent('deck:drag-end', dragColumnId.value)
    cleanupDrag()
  }

  /** Emit a cross-window drag event via Tauri IPC (no-op in browser) */
  function emitDragEvent(
    event: 'deck:drag-start' | 'deck:drag-end',
    columnId: string | null,
  ) {
    if (!columnId) return
    emitTauri(event, {
      columnId,
      sourceWindowId: deckStore.currentWindowId ?? '__main__',
    }).catch((e) => {
      // Not running in Tauri (browser dev mode) — expected
      if (import.meta.env.DEV) console.debug('[column-drag] emit failed:', e)
    })
  }

  return { dragColumnId, dropTarget, startDrag }
}

import type { Ref } from 'vue'
import { onScopeDispose, ref } from 'vue'
import { buildColumnDefaults, WIDE_COLUMN_TYPES } from '@/columns/registry'
import type { DeckColumn, useDeckStore } from '@/stores/deck'

const COL_MIN_WIDTH = 280
const COL_MAX_WIDTH = 600

export function useColumnResize(
  columnMap: Ref<Map<string, DeckColumn>>,
  deckStore: ReturnType<typeof useDeckStore>,
) {
  const resizingColId = ref<string | null>(null)
  const resizingColStartX = ref(0)
  const resizingColStartW = ref(0)

  function getColMaxWidth(colId: string): number {
    const col = columnMap.value.get(colId)
    return col && WIDE_COLUMN_TYPES.has(col.type) ? 1200 : COL_MAX_WIDTH
  }

  function onColumnResize(e: PointerEvent) {
    if (!resizingColId.value) return
    const delta = e.clientX - resizingColStartX.value
    const maxW = getColMaxWidth(resizingColId.value)
    const newW = Math.max(
      COL_MIN_WIDTH,
      Math.min(resizingColStartW.value + delta, maxW),
    )
    deckStore.updateColumn(resizingColId.value, { width: newW })
  }

  function stopColumnResize() {
    resizingColId.value = null
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    document.removeEventListener('pointermove', onColumnResize)
    document.removeEventListener('pointerup', stopColumnResize)
    document.removeEventListener('pointercancel', stopColumnResize)
  }

  function startColumnResize(colId: string, e: PointerEvent) {
    e.preventDefault()
    const col = columnMap.value.get(colId)
    if (!col) return
    resizingColId.value = colId
    resizingColStartX.value = e.clientX
    resizingColStartW.value = col.width
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('pointermove', onColumnResize)
    document.addEventListener('pointerup', stopColumnResize)
    document.addEventListener('pointercancel', stopColumnResize)
  }

  /** ダブルクリックで種別の既定幅に戻す (リサイズハンドルの慣習) */
  function resetColumnWidth(colId: string) {
    const col = columnMap.value.get(colId)
    if (!col) return
    deckStore.updateColumn(colId, {
      width: buildColumnDefaults(col.type, col.accountId).width,
    })
  }

  onScopeDispose(() => {
    if (resizingColId.value) stopColumnResize()
  })

  return {
    resizingColId,
    startColumnResize,
    resetColumnWidth,
    WIDE_COLUMN_TYPES,
  }
}

import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { DEFAULT_COLUMN_WIDTH } from '@/columns/registry'
import type { DeckColumn, useDeckStore } from '@/stores/deck'
import { useColumnResize } from './useColumnResize'

function setup(col: Partial<DeckColumn>) {
  const column = {
    id: 'c1',
    type: 'timeline',
    width: 520,
    accountId: null,
    ...col,
  } as DeckColumn
  const updateColumn = vi.fn()
  const deckStore = { updateColumn } as unknown as ReturnType<
    typeof useDeckStore
  >
  const scope = effectScope()
  const api = scope.run(() =>
    useColumnResize(ref(new Map([[column.id, column]])), deckStore),
  )
  if (!api) throw new Error('scope')
  return { api, updateColumn }
}

describe('useColumnResize.resetColumnWidth', () => {
  it('種別の既定幅に戻す', () => {
    const { api, updateColumn } = setup({ type: 'timeline' })
    api.resetColumnWidth('c1')
    expect(updateColumn).toHaveBeenCalledWith('c1', {
      width: DEFAULT_COLUMN_WIDTH,
    })
  })

  it('知らないカラムは何もしない', () => {
    const { api, updateColumn } = setup({})
    api.resetColumnWidth('nope')
    expect(updateColumn).not.toHaveBeenCalled()
  })
})

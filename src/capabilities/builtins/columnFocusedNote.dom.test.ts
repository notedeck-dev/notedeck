// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { variantKey } from '@/services/noteKey'
import { useDeckStore } from '@/stores/deck'
import { columnFocusedNoteCapability } from './column'

describe('column.focusedNote', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('投稿者の username / host を含める (ローカルは host = null)', () => {
    const deck = useDeckStore()
    deck.load()
    const col = deck.addColumn({ type: 'home', accountId: null } as never)
    deck.setActiveColumn(col.id)
    deck.reportVisibleItems(col.id, [
      {
        id: 'n1',
        _accountId: 'a1',
        userId: 'u1',
        user: { username: 'alice', host: 'remote.example' },
      },
      {
        id: 'n2',
        _accountId: 'a1',
        userId: 'u2',
        user: { username: 'bob', host: null },
      },
    ])

    deck.setFocusedNoteKey(col.id, variantKey('a1', 'n1'))
    expect(columnFocusedNoteCapability.execute({})).toMatchObject({
      note: {
        id: 'n1',
        userId: 'u1',
        username: 'alice',
        host: 'remote.example',
      },
    })

    deck.setFocusedNoteKey(col.id, variantKey('a1', 'n2'))
    expect(columnFocusedNoteCapability.execute({})).toMatchObject({
      note: { id: 'n2', username: 'bob', host: null },
    })
  })
})

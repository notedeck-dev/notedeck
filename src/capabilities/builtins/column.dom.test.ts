// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { variantKey } from '@/services/noteKey'
import { useDeckStore } from '@/stores/deck'
import {
  columnActiveCapability,
  columnFocusedNoteCapability,
  columnListCapability,
} from './column'

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

describe('column.list / column.active のカラム設定 (#1242)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('作り直すのに要る設定を含め、未設定のものは出さない', () => {
    const deck = useDeckStore()
    deck.load()
    const tl = deck.addColumn({
      type: 'timeline',
      accountId: 'a1',
      tl: 'social',
      noteQueryRefs: ['q1'],
    } as never)
    const list = deck.addColumn({
      type: 'list',
      accountId: 'a1',
      listId: 'L1',
    } as never)

    const rows = columnListCapability.execute({}) as Record<string, unknown>[]
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(tl.id)).toMatchObject({
      tl: 'social',
      queryIds: ['q1'],
      width: tl.width,
    })
    expect(byId.get(list.id)).toMatchObject({ listId: 'L1' })
    expect(byId.get(list.id)).not.toHaveProperty('tl')
    expect(byId.get(list.id)).not.toHaveProperty('queryIds')

    deck.setActiveColumn(list.id)
    expect(columnActiveCapability.execute({})).toMatchObject({
      column: { id: list.id, listId: 'L1', width: list.width },
    })
  })
})

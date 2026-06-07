import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { useNoteStore } from '@/stores/notes'

function makeNote(id: string): NormalizedNote {
  return {
    id,
    createdAt: `2026-01-01T00:00:00.${id.padStart(3, '0')}Z`,
    text: `note ${id}`,
    user: { id: 'u1', username: 'user', host: null, avatarUrl: null },
    visibility: 'public',
    reactions: {},
    reactionEmojis: {},
    files: [],
    _accountId: 'acc1',
  } as NormalizedNote
}

describe('useNoteStore deleted tombstone (#602)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('marks a removed note as deleted', () => {
    const store = useNoteStore()
    store.put([makeNote('1')])
    store.remove('1')
    expect(store.isDeleted('1')).toBe(true)
  })

  it('does not mark unrelated notes as deleted', () => {
    const store = useNoteStore()
    store.put([makeNote('1'), makeNote('2')])
    store.remove('1')
    expect(store.isDeleted('2')).toBe(false)
  })

  it('keeps a deleted tombstone after the note is re-inserted (reload)', () => {
    const store = useNoteStore()
    store.put([makeNote('1')])
    store.remove('1')
    // Simulate SQLite reload re-inserting the deleted note into the map.
    store.put([makeNote('1')])
    expect(store.isDeleted('1')).toBe(true)
  })

  it('does not tombstone when remove is called with tombstone=false (purge)', () => {
    const store = useNoteStore()
    store.put([makeNote('1')])
    // Background verify-miss is heuristic: must not permanently hide a live note.
    store.remove('1', false)
    expect(store.isDeleted('1')).toBe(false)
  })
})

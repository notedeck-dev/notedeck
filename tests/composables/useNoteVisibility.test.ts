import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { useNoteVisibility } from '@/composables/useNoteVisibility'
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

describe('useNoteVisibility', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hides a deleted note', () => {
    const noteStore = useNoteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1')
    noteStore.put([note])
    expect(isHidden(note)).toBe(false)

    noteStore.remove('1')
    expect(isHidden(note)).toBe(true)
  })

  it('does not hide a live note', () => {
    const noteStore = useNoteStore()
    const { isHidden } = useNoteVisibility()
    const a = makeNote('1')
    const b = makeNote('2')
    noteStore.put([a, b])
    noteStore.remove('1')
    expect(isHidden(b)).toBe(false)
  })
})

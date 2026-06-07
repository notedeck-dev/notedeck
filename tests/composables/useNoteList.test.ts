import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { NOTE_LIST_MAX, useNoteList } from '@/composables/useNoteList'
import { useMuteStore } from '@/stores/mutes'
import { useNoteStore } from '@/stores/notes'

function makeNote(id: string, createdAt?: string): NormalizedNote {
  return {
    id,
    createdAt: createdAt ?? `2026-01-01T00:00:00.${id.padStart(3, '0')}Z`,
    text: `note ${id}`,
    user: { id: 'u1', username: 'user', host: null, avatarUrl: null },
    visibility: 'public',
    reactions: {},
    reactionEmojis: {},
    files: [],
    _accountId: 'acc1',
  } as NormalizedNote
}

function createNoteList(maxNotes?: number) {
  return useNoteList({
    getMyUserId: () => 'u1',
    getAdapter: () => null,
    deleteHandler: async () => true,
    closePostForm: () => {
      /* noop */
    },
    maxNotes,
  })
}

describe('useNoteList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stores and retrieves notes', () => {
    const { notes, setNotes } = createNoteList()
    const items = [makeNote('1'), makeNote('2'), makeNote('3')]
    setNotes(items)
    expect(notes.value).toHaveLength(3)
    expect(notes.value.map((n) => n.id)).toEqual(['1', '2', '3'])
  })

  it('trims notes exceeding default NOTE_LIST_MAX', () => {
    const { notes, setNotes, noteIds } = createNoteList()
    const items = Array.from({ length: NOTE_LIST_MAX + 50 }, (_, i) =>
      makeNote(String(i)),
    )
    setNotes(items)
    expect(notes.value).toHaveLength(NOTE_LIST_MAX)
    expect(noteIds.size).toBe(NOTE_LIST_MAX)
  })

  it('trims notes exceeding custom maxNotes', () => {
    const { notes, setNotes, noteIds } = createNoteList(10)
    const items = Array.from({ length: 25 }, (_, i) => makeNote(String(i)))
    setNotes(items)
    expect(notes.value).toHaveLength(10)
    expect(noteIds.size).toBe(10)
    // First 10 notes are kept (newest at top)
    expect(notes.value.map((n) => n.id)).toEqual(
      items.slice(0, 10).map((n) => n.id),
    )
  })

  it('trims on direct notes.value assignment', () => {
    const { notes, noteIds } = createNoteList(5)
    const items = Array.from({ length: 10 }, (_, i) => makeNote(String(i)))
    notes.value = items
    expect(notes.value).toHaveLength(5)
    expect(noteIds.size).toBe(5)
  })

  it('does not trim when under limit', () => {
    const { notes, setNotes } = createNoteList(100)
    const items = Array.from({ length: 50 }, (_, i) => makeNote(String(i)))
    setNotes(items)
    expect(notes.value).toHaveLength(50)
  })

  it('does not resurrect a deleted note when the cache reloads it (#602)', () => {
    const { notes, setNotes } = createNoteList()
    const noteStore = useNoteStore()
    setNotes([makeNote('1'), makeNote('2'), makeNote('3')])

    noteStore.remove('2')

    // Tab switch reloads the SQLite cache, which still contains the deleted note.
    setNotes([makeNote('1'), makeNote('2'), makeNote('3')])

    expect(notes.value.map((n) => n.id)).toEqual(['1', '3'])
  })

  it('reactively hides an already-displayed note when its author is muted (#574)', () => {
    const { notes, setNotes } = createNoteList()
    const muteStore = useMuteStore()
    // makeNote authors every note as user 'u1' on account 'acc1'.
    setNotes([makeNote('1'), makeNote('2'), makeNote('3')])
    expect(notes.value).toHaveLength(3)

    // Mute without reloading the list — the computed must re-evaluate.
    muteStore.mute('acc1', 'u1')
    expect(notes.value).toHaveLength(0)

    // Unmute restores the notes reactively.
    muteStore.unmute('acc1', 'u1')
    expect(notes.value.map((n) => n.id)).toEqual(['1', '2', '3'])
  })

  it('retains muted notes in orderedIds so a snapshot restores them on unmute (#574)', () => {
    const { notes, setNotes, orderedIds } = createNoteList()
    const muteStore = useMuteStore()
    const noteStore = useNoteStore()
    setNotes([makeNote('1'), makeNote('2'), makeNote('3')]) // all authored by 'u1'

    muteStore.mute('acc1', 'u1')
    expect(notes.value).toHaveLength(0) // hidden at display

    // A tab-switch snapshot must capture the unfiltered membership, not the
    // filtered display — otherwise muted notes are baked out and unmute can't
    // bring them back.
    expect(orderedIds.value).toEqual(['1', '2', '3'])

    // Simulate snapshot save (unfiltered ids) → restore.
    setNotes(noteStore.resolve(orderedIds.value))
    muteStore.unmute('acc1', 'u1')
    expect(notes.value.map((n) => n.id)).toEqual(['1', '2', '3'])
  })

  it('passes trimmed notes to onNotesChanged callback', () => {
    const callback = vi.fn()
    const { setNotes } = useNoteList({
      getMyUserId: () => 'u1',
      getAdapter: () => null,
      deleteHandler: async () => true,
      closePostForm: () => {
        /* noop */
      },
      onNotesChanged: callback,
      maxNotes: 5,
    })
    const items = Array.from({ length: 10 }, (_, i) => makeNote(String(i)))
    setNotes(items)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toHaveLength(5)
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { NOTE_LIST_MAX, useNoteList } from '@/composables/useNoteList'
import { variantKey } from '@/services/noteKey'
import { useMutesStore } from '@/stores/mutes'
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
    const { notes, setNotes, noteKeys } = createNoteList()
    const items = Array.from({ length: NOTE_LIST_MAX + 50 }, (_, i) =>
      makeNote(String(i)),
    )
    setNotes(items)
    expect(notes.value).toHaveLength(NOTE_LIST_MAX)
    expect(noteKeys.size).toBe(NOTE_LIST_MAX)
  })

  it('trims notes exceeding custom maxNotes', () => {
    const { notes, setNotes, noteKeys } = createNoteList(10)
    const items = Array.from({ length: 25 }, (_, i) => makeNote(String(i)))
    setNotes(items)
    expect(notes.value).toHaveLength(10)
    expect(noteKeys.size).toBe(10)
    // First 10 notes are kept (newest at top)
    expect(notes.value.map((n) => n.id)).toEqual(
      items.slice(0, 10).map((n) => n.id),
    )
  })

  it('trims on direct rawNotes.value assignment', () => {
    const { notes, rawNotes, noteKeys } = createNoteList(5)
    const items = Array.from({ length: 10 }, (_, i) => makeNote(String(i)))
    rawNotes.value = items
    expect(notes.value).toHaveLength(5)
    expect(noteKeys.size).toBe(5)
  })

  it('rawNotes は可視性述語でフィルタされず、notes だけが隠される (#831)', () => {
    const { notes, rawNotes, setNotes } = createNoteList()
    const muteStore = useMutesStore()
    setNotes([makeNote('1'), makeNote('2'), makeNote('3')])

    muteStore.muteUser('acc1', 'u1')
    expect(notes.value).toHaveLength(0)
    // 書込基底は隠れたノートを保持し続ける（同期位置の決定に使う）
    expect(rawNotes.value.map((n) => n.id)).toEqual(['1', '2', '3'])
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

    noteStore.remove(variantKey('acc1', '2'))

    // Tab switch reloads the SQLite cache, which still contains the deleted note.
    setNotes([makeNote('1'), makeNote('2'), makeNote('3')])

    expect(notes.value.map((n) => n.id)).toEqual(['1', '3'])
  })

  it('reactively hides an already-displayed note when its author is muted (#574)', () => {
    const { notes, setNotes } = createNoteList()
    const muteStore = useMutesStore()
    // makeNote authors every note as user 'u1' on account 'acc1'.
    setNotes([makeNote('1'), makeNote('2'), makeNote('3')])
    expect(notes.value).toHaveLength(3)

    // Mute without reloading the list — the computed must re-evaluate.
    muteStore.muteUser('acc1', 'u1')
    expect(notes.value).toHaveLength(0)

    // Unmute restores the notes reactively.
    muteStore.unmuteUser('acc1', 'u1')
    expect(notes.value.map((n) => n.id)).toEqual(['1', '2', '3'])
  })

  it('retains muted notes in orderedKeys so a snapshot restores them on unmute (#574)', () => {
    const { notes, rawNotes, setNotes, orderedKeys } = createNoteList()
    const muteStore = useMutesStore()
    setNotes([makeNote('1'), makeNote('2'), makeNote('3')]) // all authored by 'u1'

    muteStore.muteUser('acc1', 'u1')
    expect(notes.value).toHaveLength(0) // hidden at display

    // A tab-switch snapshot must capture the unfiltered membership, not the
    // filtered display — otherwise muted notes are baked out and unmute can't
    // bring them back.
    expect(orderedKeys.value).toEqual(
      ['1', '2', '3'].map((id) => variantKey('acc1', id)),
    )

    // Simulate snapshot save (unfiltered) → restore.
    setNotes(rawNotes.value)
    muteStore.unmuteUser('acc1', 'u1')
    expect(notes.value.map((n) => n.id)).toEqual(['1', '2', '3'])
  })

  it('隠れている間にマージしても焼き込まれず、解除で復活する (#831)', () => {
    const { notes, mergeUpdate, setNotes } = createNoteList()
    const muteStore = useMutesStore()
    setNotes([makeNote('2'), makeNote('1')]) // 新しい順

    muteStore.muteUser('acc1', 'u1')
    expect(notes.value).toHaveLength(0)

    // 隠れている状態での read-modify-write。filtered を基底にすると
    // ここで '1' '2' が列から落ちる
    mergeUpdate([makeNote('3')])

    muteStore.unmuteUser('acc1', 'u1')
    expect(notes.value.map((n) => n.id)).toEqual(['3', '2', '1'])
  })

  it('passes trimmed notes to onNotesChanged callback', () => {
    const callback = vi.fn()
    const { setNotes } = useNoteList({
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

describe('useNoteList bundle (#1058 束ね)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function variant(
    id: string,
    accountId: string,
    host: string,
    uri?: string,
  ): NormalizedNote {
    const identity = uri ?? `https://${host}/notes/${id}`
    const identityHost = identity.replace(/^https?:\/\//, '').split('/')[0]
    return {
      ...makeNote(id),
      _accountId: accountId,
      _serverHost: host,
      _identity: identity,
      _isOrigin: identityHost === host,
      _identityTrusted: true,
      contentHidden: false,
      uri,
    }
  }

  function createBundled(maxNotes?: number) {
    return useNoteList({
      bundle: true,
      getAdapter: () => null,
      deleteHandler: async () => true,
      closePostForm: () => {
        /* noop */
      },
      maxNotes,
    })
  }

  it('同一 identity の variant を 1 行に畳み、主ビューは origin', () => {
    const { notes, groups, rawNotes, setNotes } = createBundled()
    const remote = variant(
      'r1',
      'acc-b',
      'b.example',
      'https://origin.example/notes/o1',
    )
    const origin = variant('o1', 'acc-o', 'origin.example')
    setNotes([remote, origin])
    expect(rawNotes.value).toHaveLength(2)
    expect(notes.value).toHaveLength(1)
    expect(notes.value[0]).toBe(origin)
    expect(groups.value[0]?.variants).toHaveLength(2)
  })

  it('どれかのアカウントのミュートで group ごと隠れる (ユーザー意思の OR)', () => {
    const { notes, setNotes } = createBundled()
    const muteStore = useMutesStore()
    setNotes([
      variant('r1', 'acc-b', 'b.example', 'https://origin.example/notes/o1'),
      variant('o1', 'acc-o', 'origin.example'),
    ])
    expect(notes.value).toHaveLength(1)
    muteStore.muteUser('acc-b', 'u1')
    expect(notes.value).toHaveLength(0)
    muteStore.unmuteUser('acc-b', 'u1')
    expect(notes.value).toHaveLength(1)
  })

  it('上限は group 数で数える', () => {
    const { notes, rawNotes, setNotes } = createBundled(1)
    setNotes([
      variant('r1', 'acc-b', 'b.example', 'https://origin.example/notes/o1'),
      variant('x', 'acc-b', 'b.example'),
      variant('o1', 'acc-o', 'origin.example'),
    ])
    // 同 identity は隣接に寄せられ、1 group = 2 variant が残る
    expect(rawNotes.value).toHaveLength(2)
    expect(notes.value).toHaveLength(1)
  })
})

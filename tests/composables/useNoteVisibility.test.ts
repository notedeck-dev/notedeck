import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { useNoteVisibility } from '@/composables/useNoteVisibility'
import { useMuteStore } from '@/stores/mutes'
import { useNoteStore } from '@/stores/notes'

function makeNote(
  id: string,
  userId = 'u1',
  extra: Partial<NormalizedNote> = {},
): NormalizedNote {
  return {
    id,
    createdAt: `2026-01-01T00:00:00.${id.padStart(3, '0')}Z`,
    text: `note ${id}`,
    user: { id: userId, username: 'user', host: null, avatarUrl: null },
    visibility: 'public',
    reactions: {},
    reactionEmojis: {},
    files: [],
    _accountId: 'acc1',
    ...extra,
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

  it('hides a note authored by a muted user, restores on unmute (#574)', () => {
    const muteStore = useMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'muted-user')
    expect(isHidden(note)).toBe(false)

    muteStore.mute('acc1', 'muted-user')
    expect(isHidden(note)).toBe(true)

    muteStore.unmute('acc1', 'muted-user')
    expect(isHidden(note)).toBe(false)
  })

  it('hides a note whose reply target is a muted user (#574)', () => {
    const muteStore = useMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'author', {
      reply: makeNote('0', 'muted-user'),
    })
    muteStore.mute('acc1', 'muted-user')
    expect(isHidden(note)).toBe(true)
  })

  it('hides a renote of a muted user (#574)', () => {
    const muteStore = useMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'author', {
      renote: makeNote('0', 'muted-user'),
    })
    muteStore.mute('acc1', 'muted-user')
    expect(isHidden(note)).toBe(true)
  })

  it('scopes mute per account', () => {
    const muteStore = useMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'u9') // _accountId: 'acc1'
    muteStore.mute('acc2', 'u9')
    expect(isHidden(note)).toBe(false)
  })
})

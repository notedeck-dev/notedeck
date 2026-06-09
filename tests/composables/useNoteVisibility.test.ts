import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedNote, NormalizedNotification } from '@/adapters/types'
import { useNoteVisibility } from '@/composables/useNoteVisibility'
import { useInstanceMuteStore } from '@/stores/instanceMutes'
import { useMuteStore } from '@/stores/mutes'
import { useNoteStore } from '@/stores/notes'
import { useRenoteMuteStore } from '@/stores/renoteMutes'
import { useWordMuteStore } from '@/stores/wordMutes'

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

function makeUser(id: string) {
  return { id, username: 'user', host: null, avatarUrl: null }
}

function makeNotif(
  type: string,
  extra: Partial<NormalizedNotification> = {},
): NormalizedNotification {
  return {
    id: 'n1',
    _accountId: 'acc1',
    _serverHost: 'example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    type,
    ...extra,
  } as NormalizedNotification
}

describe('useNoteVisibility.isNotificationHidden (#606)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hides a notification from a muted notifier, restores on unmute', () => {
    const muteStore = useMuteStore()
    const { isNotificationHidden } = useNoteVisibility()
    const notif = makeNotif('reaction', {
      user: { id: 'muted-user', username: 'u', host: null, avatarUrl: null },
      reaction: '👍',
    })
    expect(isNotificationHidden(notif)).toBe(false)

    muteStore.mute('acc1', 'muted-user')
    expect(isNotificationHidden(notif)).toBe(true)

    muteStore.unmute('acc1', 'muted-user')
    expect(isNotificationHidden(notif)).toBe(false)
  })

  it('hides a follow notification (no note) from a muted notifier', () => {
    const muteStore = useMuteStore()
    const { isNotificationHidden } = useNoteVisibility()
    const notif = makeNotif('follow', {
      user: { id: 'muted-user', username: 'u', host: null, avatarUrl: null },
    })
    muteStore.mute('acc1', 'muted-user')
    expect(isNotificationHidden(notif)).toBe(true)
  })

  it('hides a notification whose related note is deleted', () => {
    const noteStore = useNoteStore()
    const { isNotificationHidden } = useNoteVisibility()
    const note = makeNote('1')
    noteStore.put([note])
    const notif = makeNotif('mention', {
      user: { id: 'author', username: 'u', host: null, avatarUrl: null },
      note,
    })
    expect(isNotificationHidden(notif)).toBe(false)

    noteStore.remove('1')
    expect(isNotificationHidden(notif)).toBe(true)
  })

  it('hides a grouped reaction when all reactors are muted (#575)', () => {
    const muteStore = useMuteStore()
    const { isNotificationHidden } = useNoteVisibility()
    const notif = makeNotif('reaction:grouped', {
      reactions: [
        { user: makeUser('muted-user'), reaction: '👍' },
        { user: makeUser('muted-user'), reaction: '🎉' },
      ],
    })
    expect(isNotificationHidden(notif)).toBe(false)

    muteStore.mute('acc1', 'muted-user')
    expect(isNotificationHidden(notif)).toBe(true)
  })

  it('keeps a grouped reaction with a non-muted reactor, filtering the muted one (#575)', () => {
    const muteStore = useMuteStore()
    const { isNotificationHidden, visibleReactions } = useNoteVisibility()
    const notif = makeNotif('reaction:grouped', {
      reactions: [
        { user: makeUser('muted-user'), reaction: '👍' },
        { user: makeUser('other-user'), reaction: '🎉' },
      ],
    })
    muteStore.mute('acc1', 'muted-user')
    expect(isNotificationHidden(notif)).toBe(false)
    const visible = visibleReactions(notif)
    expect(visible).toHaveLength(1)
    expect(visible[0].user.id).toBe('other-user')
  })

  it('hides a grouped renote when all renoters are muted (#575)', () => {
    const muteStore = useMuteStore()
    const { isNotificationHidden, visibleGroupedUsers } = useNoteVisibility()
    const notif = makeNotif('renote:grouped', {
      users: [makeUser('muted-user'), makeUser('other-user')],
    })
    muteStore.mute('acc1', 'muted-user')
    expect(isNotificationHidden(notif)).toBe(false)
    expect(visibleGroupedUsers(notif)).toHaveLength(1)

    muteStore.mute('acc1', 'other-user')
    expect(isNotificationHidden(notif)).toBe(true)
  })
})

describe('useNoteVisibility word mute (#610)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hides a note matching hardMutedWords, restores when removed', () => {
    const wordMuteStore = useWordMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'author', { text: 'this is spam content' })
    expect(isHidden(note)).toBe(false)

    wordMuteStore.setWords('acc1', [], [['spam']])
    expect(isHidden(note)).toBe(true)

    wordMuteStore.setWords('acc1', [], [])
    expect(isHidden(note)).toBe(false)
  })

  it('soft mute does not hide but flags isSoftWordMuted', () => {
    const wordMuteStore = useWordMuteStore()
    const { isHidden, isSoftWordMuted } = useNoteVisibility()
    const note = makeNote('1', 'author', { text: 'mild spoiler here' })
    wordMuteStore.setWords('acc1', [['spoiler']], [])
    expect(isHidden(note)).toBe(false)
    expect(isSoftWordMuted(note)).toBe(true)
  })

  it('matches against cw text', () => {
    const wordMuteStore = useWordMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'author', {
      text: 'body',
      cw: 'spoiler warning',
    })
    wordMuteStore.setWords('acc1', [], [['spoiler']])
    expect(isHidden(note)).toBe(true)
  })

  it('matches via renote text (本家 parity)', () => {
    const wordMuteStore = useWordMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'author', {
      text: 'clean',
      renote: makeNote('0', 'other', { text: 'banned word inside' }),
    })
    wordMuteStore.setWords('acc1', [], [['banned']])
    expect(isHidden(note)).toBe(true)
  })
})

describe('useNoteVisibility renote mute (#614)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hides a pure renote from a renote-muted user, restores on unmute', () => {
    const renoteMuteStore = useRenoteMuteStore()
    const { isHidden } = useNoteVisibility()
    const renote = makeNote('1', 'renoter', {
      text: null,
      renote: makeNote('0', 'orig'),
    })
    expect(isHidden(renote)).toBe(false)

    renoteMuteStore.mute('acc1', 'renoter')
    expect(isHidden(renote)).toBe(true)

    renoteMuteStore.unmute('acc1', 'renoter')
    expect(isHidden(renote)).toBe(false)
  })

  it('does not hide a quote (text present) from a renote-muted user', () => {
    const renoteMuteStore = useRenoteMuteStore()
    const { isHidden } = useNoteVisibility()
    const quote = makeNote('1', 'renoter', {
      text: 'my comment',
      renote: makeNote('0', 'orig'),
    })
    renoteMuteStore.mute('acc1', 'renoter')
    expect(isHidden(quote)).toBe(false)
  })

  it('does not hide a normal note from a renote-muted user', () => {
    const renoteMuteStore = useRenoteMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'renoter', { text: 'just posting' })
    renoteMuteStore.mute('acc1', 'renoter')
    expect(isHidden(note)).toBe(false)
  })
})

describe('useNoteVisibility instance mute (#613)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function noteFromHost(id: string, host: string | null): NormalizedNote {
    return makeNote(id, 'u1', {
      user: { id: 'u1', username: 'u', host, avatarUrl: null },
    })
  }

  it('hides a note from a muted instance, restores on unmute', () => {
    const instanceMuteStore = useInstanceMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = noteFromHost('1', 'bad.example')
    expect(isHidden(note)).toBe(false)

    instanceMuteStore.setMuted('acc1', ['bad.example'])
    expect(isHidden(note)).toBe(true)

    instanceMuteStore.setMuted('acc1', [])
    expect(isHidden(note)).toBe(false)
  })

  it('does not hide local (host=null) notes', () => {
    const instanceMuteStore = useInstanceMuteStore()
    const { isHidden } = useNoteVisibility()
    instanceMuteStore.setMuted('acc1', ['bad.example'])
    expect(isHidden(noteFromHost('1', null))).toBe(false)
  })

  it('hides when the renote target is from a muted instance', () => {
    const instanceMuteStore = useInstanceMuteStore()
    const { isHidden } = useNoteVisibility()
    const note = makeNote('1', 'local', {
      renote: noteFromHost('0', 'bad.example'),
    })
    instanceMuteStore.setMuted('acc1', ['bad.example'])
    expect(isHidden(note)).toBe(true)
  })
})

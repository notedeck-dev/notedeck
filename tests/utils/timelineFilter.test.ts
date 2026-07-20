import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { matchesFilter } from '@/utils/timelineFilter'

function makeNote(overrides: Partial<NormalizedNote> = {}): NormalizedNote {
  return {
    id: 'note1',
    text: 'hello',
    createdAt: '2025-01-01T00:00:00Z',
    user: {
      id: 'u1',
      username: 'testuser',
      host: null,
      name: null,
      avatarUrl: null,
    },
    visibility: 'public',
    reactions: {},
    myReaction: null,
    emojis: {},
    reactionEmojis: {},
    files: [],
    renoteCount: 0,
    repliesCount: 0,
    cw: null,
    _accountId: 'a1',
    _serverHost: 'example.com',
    ...overrides,
  }
}

describe('matchesFilter', () => {
  it('passes everything without filter or timeline type', () => {
    expect(matchesFilter(makeNote())).toBe(true)
  })

  it('excludes non-public notes on local/global timelines', () => {
    const home = makeNote({ visibility: 'home' })
    expect(matchesFilter(home, undefined, 'local')).toBe(false)
    expect(matchesFilter(home, undefined, 'global')).toBe(false)
    expect(matchesFilter(home, undefined, 'home')).toBe(true)
    expect(matchesFilter(home, undefined, 'social')).toBe(true)
    expect(matchesFilter(makeNote(), undefined, 'local')).toBe(true)
  })

  it('withRenotes=false excludes pure renotes but keeps quotes', () => {
    const pureRenote = makeNote({ text: null, renote: makeNote({ id: 'r1' }) })
    const quote = makeNote({ text: 'quoting', renote: makeNote({ id: 'r1' }) })
    expect(matchesFilter(pureRenote, { withRenotes: false })).toBe(false)
    expect(matchesFilter(quote, { withRenotes: false })).toBe(true)
    expect(matchesFilter(pureRenote, { withRenotes: true })).toBe(true)
    expect(matchesFilter(pureRenote, {})).toBe(true)
  })

  it('withReplies=false excludes replies', () => {
    const reply = makeNote({ reply: makeNote({ id: 'p1' }) })
    expect(matchesFilter(reply, { withReplies: false })).toBe(false)
    expect(matchesFilter(reply, { withReplies: true })).toBe(true)
    expect(matchesFilter(makeNote(), { withReplies: false })).toBe(true)
  })

  it('withFiles=true keeps only notes with files (own or renoted)', () => {
    const file = {
      id: 'f1',
      url: 'https://example.com/f.png',
      thumbnailUrl: null,
      type: 'image/png',
      isSensitive: false,
      name: 'f.png',
    } as NormalizedNote['files'][number]
    expect(matchesFilter(makeNote(), { withFiles: true })).toBe(false)
    expect(
      matchesFilter(makeNote({ files: [file] }), { withFiles: true }),
    ).toBe(true)
    expect(
      matchesFilter(makeNote({ renote: makeNote({ files: [file] }) }), {
        withFiles: true,
      }),
    ).toBe(true)
    expect(matchesFilter(makeNote(), { withFiles: false })).toBe(true)
  })

  it('withBots=false excludes bot notes', () => {
    const bot = makeNote({
      user: {
        id: 'u2',
        username: 'bot',
        host: null,
        name: null,
        avatarUrl: null,
        isBot: true,
      },
    })
    expect(matchesFilter(bot, { withBots: false })).toBe(false)
    expect(matchesFilter(bot, { withBots: true })).toBe(true)
    // isBot undefined is treated as non-bot
    expect(matchesFilter(makeNote(), { withBots: false })).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import {
  extractLiterals,
  filterNotesByRegex,
  filterNotesByRegexAsync,
  isValidRegex,
  RegexFilterError,
  safeRegex,
} from '@/utils/regexSearch'

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

describe('extractLiterals', () => {
  it('returns the longest literal part of a pattern', () => {
    expect(extractLiterals('(cat|dog).*food')).toBe('food')
  })

  it('returns a plain literal pattern as-is', () => {
    expect(extractLiterals('misskey')).toBe('misskey')
  })

  it('drops literal parts shorter than 2 chars', () => {
    expect(extractLiterals('a|b')).toBe('')
    expect(extractLiterals('a.*bc')).toBe('bc')
  })

  it('returns empty string for empty or all-meta patterns', () => {
    expect(extractLiterals('')).toBe('')
    expect(extractLiterals('.*+?')).toBe('')
  })

  it('handles Unicode literals', () => {
    expect(extractLiterals('こんにちは.*世界')).toBe('こんにちは')
  })
})

describe('safeRegex / isValidRegex', () => {
  it('returns a case-insensitive RegExp for valid patterns', () => {
    const re = safeRegex('Hello')
    expect(re).toBeInstanceOf(RegExp)
    expect(re?.flags).toContain('i')
    expect(re?.test('HELLO world')).toBe(true)
  })

  it('returns null for invalid patterns', () => {
    expect(safeRegex('(')).toBeNull()
    expect(safeRegex('[a-')).toBeNull()
  })

  it('isValidRegex reflects validity', () => {
    expect(isValidRegex('a+b')).toBe(true)
    expect(isValidRegex('(')).toBe(false)
  })
})

describe('filterNotesByRegex', () => {
  it('matches against text, cw, user name and username', () => {
    const notes = [
      makeNote({ id: 'n1', text: 'apple pie' }),
      makeNote({ id: 'n2', text: null, cw: 'apple warning' }),
      makeNote({
        id: 'n3',
        text: 'unrelated',
        user: {
          id: 'u2',
          username: 'someone',
          host: null,
          name: 'Apple Fan',
          avatarUrl: null,
        },
      }),
      makeNote({
        id: 'n4',
        text: 'unrelated',
        user: {
          id: 'u3',
          username: 'applelover',
          host: null,
          name: null,
          avatarUrl: null,
        },
      }),
      makeNote({ id: 'n5', text: 'banana' }),
    ]
    const result = filterNotesByRegex(notes, 'apple')
    expect(result.map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
  })

  it('matches renote text and cw', () => {
    const notes = [
      makeNote({ id: 'n1', text: null, renote: makeNote({ text: 'apple' }) }),
      makeNote({
        id: 'n2',
        text: null,
        renote: makeNote({ text: null, cw: 'apple cw' }),
      }),
      makeNote({ id: 'n3', text: null, renote: makeNote({ text: 'banana' }) }),
    ]
    const result = filterNotesByRegex(notes, 'apple')
    expect(result.map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('is case-insensitive', () => {
    const notes = [makeNote({ text: 'HELLO' })]
    expect(filterNotesByRegex(notes, 'hello')).toHaveLength(1)
  })

  it('returns all notes for an invalid pattern', () => {
    const notes = [makeNote({ id: 'n1' }), makeNote({ id: 'n2' })]
    expect(filterNotesByRegex(notes, '(')).toEqual(notes)
  })

  it('returns empty array for empty input', () => {
    expect(filterNotesByRegex([], 'x')).toEqual([])
  })
})

describe('filterNotesByRegexAsync', () => {
  it('無効なパターンは素通しせず、照合の失敗として拒否する', async () => {
    await expect(
      filterNotesByRegexAsync([makeNote()], '(unclosed'),
    ).rejects.toMatchObject({ kind: 'invalid' })
    await expect(
      filterNotesByRegexAsync([makeNote()], '(unclosed'),
    ).rejects.toBeInstanceOf(RegexFilterError)
  })
})

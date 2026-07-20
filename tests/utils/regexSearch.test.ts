import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import {
  buildRegexFromConditions,
  extractHintFromConditions,
  extractLiterals,
  filterNotesByRegex,
  isValidRegex,
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

describe('buildRegexFromConditions', () => {
  it('builds an alternation for contains_any', () => {
    const pattern = buildRegexFromConditions([
      { type: 'contains_any', words: 'cat dog' },
    ])
    expect(pattern).toBe('(?:cat|dog)')
    const re = new RegExp(pattern)
    expect(re.test('I have a dog')).toBe(true)
    expect(re.test('I have a bird')).toBe(false)
  })

  it('builds lookaheads for contains_all', () => {
    const pattern = buildRegexFromConditions([
      { type: 'contains_all', words: 'foo bar' },
    ])
    expect(pattern).toBe('^(?=.*foo)(?=.*bar)')
    const re = new RegExp(pattern)
    expect(re.test('bar then foo')).toBe(true)
    expect(re.test('only foo')).toBe(false)
  })

  it('builds negative lookaheads for excludes', () => {
    const pattern = buildRegexFromConditions([
      { type: 'excludes', words: 'spam' },
    ])
    expect(pattern).toBe('^(?!.*spam)')
    const re = new RegExp(pattern)
    expect(re.test('clean text')).toBe(true)
    expect(re.test('this is spam')).toBe(false)
  })

  it('combines lookaheads and matches', () => {
    const pattern = buildRegexFromConditions([
      { type: 'contains_all', words: 'foo' },
      { type: 'contains_any', words: 'x y' },
    ])
    expect(pattern).toBe('^(?=.*foo).*(?:x|y)')
    const re = new RegExp(pattern)
    expect(re.test('foo with x')).toBe(true)
    expect(re.test('foo without')).toBe(false)
    expect(re.test('x without f-o-o')).toBe(false)
  })

  it('escapes regex metacharacters in words', () => {
    const pattern = buildRegexFromConditions([
      { type: 'contains_any', words: 'c++' },
    ])
    expect(new RegExp(pattern).test('I like c++')).toBe(true)
    expect(new RegExp(pattern).test('I like c')).toBe(false)
  })

  it('splits words on comma, Japanese comma and whitespace', () => {
    const pattern = buildRegexFromConditions([
      { type: 'contains_any', words: 'a1,b2、c3 d4' },
    ])
    expect(pattern).toBe('(?:a1|b2|c3|d4)')
  })

  it('returns empty string for empty or whitespace-only conditions', () => {
    expect(buildRegexFromConditions([])).toBe('')
    expect(
      buildRegexFromConditions([{ type: 'contains_any', words: '  , ' }]),
    ).toBe('')
  })
})

describe('extractHintFromConditions', () => {
  it('returns the longest word from contains conditions', () => {
    expect(
      extractHintFromConditions([
        { type: 'contains_any', words: 'ab longest' },
        { type: 'contains_all', words: 'mid' },
      ]),
    ).toBe('longest')
  })

  it('ignores excludes conditions', () => {
    expect(
      extractHintFromConditions([
        { type: 'excludes', words: 'verylongexcludedword' },
        { type: 'contains_any', words: 'hint' },
      ]),
    ).toBe('hint')
  })

  it('returns empty string when no usable words', () => {
    expect(extractHintFromConditions([])).toBe('')
    expect(
      extractHintFromConditions([{ type: 'excludes', words: 'spam' }]),
    ).toBe('')
  })
})

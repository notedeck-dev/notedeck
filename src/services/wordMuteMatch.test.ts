import { describe, expect, it } from 'vitest'
import { matchMutedWords } from '@/services/wordMuteMatch'

describe('matchMutedWords', () => {
  it('matches a single keyword group', () => {
    expect(matchMutedWords('hello world', [['world']])).toBe(true)
    expect(matchMutedWords('hello there', [['world']])).toBe(false)
  })

  it('requires all keywords in a group (AND)', () => {
    expect(matchMutedWords('foo and bar', [['foo', 'bar']])).toBe(true)
    expect(matchMutedWords('only foo', [['foo', 'bar']])).toBe(false)
  })

  it('matches if any filter matches (OR across entries)', () => {
    expect(matchMutedWords('just baz', [['foo'], ['baz']])).toBe(true)
  })

  it('matches a /regex/flags string entry', () => {
    expect(matchMutedWords('HELLO', ['/hello/i'])).toBe(true)
    expect(matchMutedWords('hello', ['/HELLO/'])).toBe(false) // case-sensitive without i
    expect(matchMutedWords('abc123', ['/\\d+/'])).toBe(true)
  })

  it('ignores invalid regex entries', () => {
    expect(matchMutedWords('anything', ['/(/'])).toBe(false)
    expect(matchMutedWords('anything', ['not-a-regex'])).toBe(false)
  })

  it('returns false for empty text or empty filters', () => {
    expect(matchMutedWords(null, [['x']])).toBe(false)
    expect(matchMutedWords('', [['x']])).toBe(false)
    expect(matchMutedWords('text', [])).toBe(false)
    expect(matchMutedWords('text', [[]])).toBe(false)
  })
})

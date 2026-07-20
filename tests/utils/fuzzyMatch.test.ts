import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from '@/utils/fuzzyMatch'

describe('fuzzyMatch', () => {
  it('matches when query chars appear in order (subsequence)', () => {
    expect(fuzzyMatch('hw', 'hello world')).toBe(true)
    expect(fuzzyMatch('hlo', 'hello')).toBe(true)
    expect(fuzzyMatch('hello', 'hello')).toBe(true)
  })

  it('rejects when chars appear out of order', () => {
    expect(fuzzyMatch('wh', 'hello world')).toBe(false)
    expect(fuzzyMatch('olleh', 'hello')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('HW', 'hello world')).toBe(true)
    expect(fuzzyMatch('hw', 'Hello World')).toBe(true)
  })

  it('returns true for empty query', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true)
    expect(fuzzyMatch('', '')).toBe(true)
  })

  it('rejects query longer than label', () => {
    expect(fuzzyMatch('abc', 'ab')).toBe(false)
    expect(fuzzyMatch('a', '')).toBe(false)
  })

  it('matches Unicode text', () => {
    expect(fuzzyMatch('タイム', 'タイムライン')).toBe(true)
    expect(fuzzyMatch('タラ', 'タイムライン')).toBe(true)
    expect(fuzzyMatch('ランタ', 'タイムライン')).toBe(false)
  })
})

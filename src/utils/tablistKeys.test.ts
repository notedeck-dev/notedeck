import { describe, expect, it } from 'vitest'
import { nextTabValue } from './tablistKeys'

describe('nextTabValue', () => {
  const tabs = ['a', 'b', 'c']
  it('左右キーで隣のタブへ、端では反対側へ回る', () => {
    expect(nextTabValue(tabs, 'a', 'ArrowRight')).toBe('b')
    expect(nextTabValue(tabs, 'c', 'ArrowRight')).toBe('a')
    expect(nextTabValue(tabs, 'a', 'ArrowLeft')).toBe('c')
  })
  it('Home / End で先頭・末尾へ', () => {
    expect(nextTabValue(tabs, 'b', 'Home')).toBe('a')
    expect(nextTabValue(tabs, 'b', 'End')).toBe('c')
  })
  it('関係ないキーやタブが無いときは null', () => {
    expect(nextTabValue(tabs, 'a', 'Enter')).toBeNull()
    expect(nextTabValue([], 'a', 'ArrowRight')).toBeNull()
  })
})

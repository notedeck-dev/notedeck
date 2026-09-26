import { describe, expect, it } from 'vitest'
import { formatCount } from './format'

describe('formatCount (#135 / #704)', () => {
  it('表示言語の compact 表記で短くする', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(12_345)).toBe('1.2万')
    expect(formatCount(1_234_567)).toBe('123.5万')
  })

  it('端数が 0 のときに「.0」を付けない', () => {
    expect(formatCount(10_000)).toBe('1万')
  })
})

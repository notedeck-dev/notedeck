import { describe, expect, it } from 'vitest'
import { formatBytes, formatCount } from './format'

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

describe('formatBytes (#135)', () => {
  it('1024 区切りで単位を上げ、端数は小数 1 桁まで', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(2.25 * 1024 ** 3)).toBe('2.3 GB')
  })

  it('負の値 (チャートの減少分) も絶対値で単位を選ぶ', () => {
    expect(formatBytes(-1536)).toBe('-1.5 KB')
  })

  it('大きな数は表示言語の書式で桁区切りする', () => {
    expect(formatBytes(1234 * 1024 ** 4)).toBe('1,234 TB')
  })
})

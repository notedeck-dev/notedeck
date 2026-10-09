import { describe, expect, it } from 'vitest'
import { dateSeparator } from './dateSeparator'

/** ローカル日付で組む (区切りは端末の日付で判定する) */
const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h).toISOString()

describe('dateSeparator (#1210)', () => {
  it('is null within the same local day', () => {
    expect(dateSeparator(at(2026, 10, 8, 23), at(2026, 10, 8, 0))).toBeNull()
  })

  it('labels both sides when the day changes', () => {
    const s = dateSeparator(at(2026, 10, 8), at(2026, 10, 7))
    expect(s).not.toBeNull()
    expect(s?.newerText).toContain('8')
    expect(s?.olderText).toContain('7')
  })

  it('treats the same day in another month or year as different', () => {
    expect(dateSeparator(at(2026, 10, 8), at(2026, 9, 8))).not.toBeNull()
    expect(dateSeparator(at(2026, 10, 8), at(2025, 10, 8))).not.toBeNull()
  })

  it('is null for missing or unreadable dates', () => {
    expect(dateSeparator(null, at(2026, 10, 8))).toBeNull()
    expect(dateSeparator(at(2026, 10, 8), 'nope')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { formatMuteExpiry } from './formatTime'

const NOW = new Date('2026-10-18T06:00:00.000Z').getTime()
const DAY = 86_400_000

function expected(at: number, withYear: boolean): string {
  return new Intl.DateTimeFormat(i18n.lang, {
    ...(withYear ? { year: 'numeric' } : {}),
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at))
}

describe('formatMuteExpiry: ミュートの期限の表示 (#1260)', () => {
  it('月日と時分だけ (秒なし、年なし)', () => {
    const at = NOW + 7 * DAY
    const s = formatMuteExpiry(at, NOW)
    expect(s).toBe(expected(at, false))
    expect(s).not.toMatch(/2026/)
    expect(s).not.toMatch(/:\d\d:\d\d/)
  })

  it('1 年以上先なら年も出す', () => {
    const at = NOW + 400 * DAY
    expect(formatMuteExpiry(at, NOW)).toBe(expected(at, true))
  })

  it('読めない値は空', () => {
    expect(formatMuteExpiry(Number.NaN, NOW)).toBe('')
  })
})

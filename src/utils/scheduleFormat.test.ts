import { describe, expect, it } from 'vitest'
import {
  formatScheduleAbsolute,
  formatScheduleRelative,
  SCHEDULE_PRESETS,
} from './scheduleFormat'

// ローカル時刻で組む (formatSchedule* はローカル時刻で表示する)
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

describe('formatScheduleAbsolute', () => {
  const now = at(2026, 12, 3, 12, 0)

  it('今日 / 明日 / 昨日は語 + 時刻', () => {
    expect(formatScheduleAbsolute(iso(at(2026, 12, 3, 14, 30)), now)).toBe(
      '今日 14:30',
    )
    expect(formatScheduleAbsolute(iso(at(2026, 12, 4, 9, 0)), now)).toBe(
      '明日 09:00',
    )
    expect(formatScheduleAbsolute(iso(at(2026, 12, 2, 0, 5)), now)).toBe(
      '昨日 00:05',
    )
  })

  it('同じ年は月/日(曜日) 時刻', () => {
    expect(formatScheduleAbsolute(iso(at(2026, 12, 5, 14, 30)), now)).toBe(
      '12/5(土) 14:30',
    )
  })

  it('別の年は年から出す', () => {
    expect(formatScheduleAbsolute(iso(at(2027, 2, 3, 10, 0)), now)).toBe(
      '2027/2/3(水) 10:00',
    )
  })
})

describe('formatScheduleRelative', () => {
  const now = at(2026, 12, 3, 12, 0)
  const plus = (min: number) => iso(now + min * 60_000)

  it('未来は「あと」', () => {
    expect(formatScheduleRelative(plus(0.5), now)).toBe('まもなく')
    expect(formatScheduleRelative(plus(30), now)).toBe('あと30分')
    expect(formatScheduleRelative(plus(120), now)).toBe('あと2時間')
    expect(formatScheduleRelative(plus(135), now)).toBe('あと2時間15分')
    expect(formatScheduleRelative(plus(3 * 1440), now)).toBe('あと3日')
  })

  it('過去は「前」', () => {
    expect(formatScheduleRelative(plus(-0.5), now)).toBe('期限切れ')
    expect(formatScheduleRelative(plus(-30), now)).toBe('30分前')
    expect(formatScheduleRelative(plus(-120), now)).toBe('2時間前')
    expect(formatScheduleRelative(plus(-135), now)).toBe('2時間15分前')
    expect(formatScheduleRelative(plus(-3 * 1440), now)).toBe('3日前')
  })

  it('7 日以上先は絶対表示', () => {
    expect(formatScheduleRelative(plus(8 * 1440), now)).toBe('12/11(金) 12:00')
  })
})

describe('SCHEDULE_PRESETS', () => {
  it('ラベル', () => {
    expect(SCHEDULE_PRESETS.map((p) => p.label)).toEqual([
      '30分後',
      '1時間後',
      '3時間後',
      '明日9:00',
      '1週間後',
    ])
  })
})

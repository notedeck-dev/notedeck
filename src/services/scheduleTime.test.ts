import { describe, expect, it } from 'vitest'
import {
  isPastSchedule,
  toLocalDateInput,
  toLocalDatetimeInput,
  toLocalTimeInput,
} from './scheduleTime'

describe('isPastSchedule', () => {
  const now = new Date(2026, 11, 3, 12, 0).getTime()

  it('now より前なら true、同時刻と未来は false', () => {
    expect(isPastSchedule(new Date(now - 1).toISOString(), now)).toBe(true)
    expect(isPastSchedule(new Date(now).toISOString(), now)).toBe(false)
    expect(isPastSchedule(new Date(now + 1).toISOString(), now)).toBe(false)
  })
})

describe('toLocal*Input', () => {
  const d = new Date(2026, 0, 5, 3, 7)

  it('ローカル時刻を 0 埋めで input の value 形式にする', () => {
    expect(toLocalDateInput(d)).toBe('2026-01-05')
    expect(toLocalTimeInput(d)).toBe('03:07')
    expect(toLocalDatetimeInput(d)).toBe('2026-01-05T03:07')
  })
})

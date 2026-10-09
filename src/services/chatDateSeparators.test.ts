import { describe, expect, it } from 'vitest'
import { chatDateSeparators } from './chatDateSeparators'

// 端末のタイムゾーンで日付を切るので、fixture もローカル時刻で組む
function at(month: number, day: number, hour = 12): string {
  return new Date(2026, month - 1, day, hour).toISOString()
}

describe('chatDateSeparators', () => {
  it('日付が変わったメッセージの前にだけ区切りを置く', () => {
    const seps = chatDateSeparators([
      { id: 'a', createdAt: at(10, 8, 9) },
      { id: 'b', createdAt: at(10, 8, 23) },
      { id: 'c', createdAt: at(10, 9, 0) },
      { id: 'd', createdAt: at(10, 9, 8) },
    ])
    expect([...seps.keys()]).toEqual(['c'])
    expect(seps.get('c')).toEqual({ prevText: '10/8', nextText: '10/9' })
  })

  it('先頭のメッセージには区切りを置かない', () => {
    const seps = chatDateSeparators([{ id: 'a', createdAt: at(10, 8) }])
    expect(seps.size).toBe(0)
  })

  it('月や年をまたいでも日付で切る', () => {
    const seps = chatDateSeparators([
      { id: 'a', createdAt: new Date(2025, 11, 31, 12).toISOString() },
      { id: 'b', createdAt: new Date(2026, 0, 1, 12).toISOString() },
      { id: 'c', createdAt: at(2, 1) },
    ])
    expect(seps.get('b')).toEqual({ prevText: '12/31', nextText: '1/1' })
    expect(seps.get('c')).toEqual({ prevText: '1/1', nextText: '2/1' })
  })

  it('同じ月日でも年が違えば切る', () => {
    const seps = chatDateSeparators([
      { id: 'a', createdAt: new Date(2025, 9, 8, 12).toISOString() },
      { id: 'b', createdAt: at(10, 8) },
    ])
    expect(seps.has('b')).toBe(true)
  })

  it('空配列は空', () => {
    expect(chatDateSeparators([]).size).toBe(0)
  })
})

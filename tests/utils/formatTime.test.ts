import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatAbsoluteTime,
  formatTime,
  toDatetimeAttr,
} from '@/utils/formatTime'

describe('formatTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('1 分未満は「たった今」', () => {
    expect(formatTime('2025-06-15T11:59:30Z')).toBe('たった今')
  })

  it('1 時間未満は分', () => {
    expect(formatTime('2025-06-15T11:45:00Z')).toBe('15 分前')
    expect(formatTime('2025-06-15T11:59:00Z')).toBe('1 分前')
  })

  it('1 日未満は時間', () => {
    expect(formatTime('2025-06-15T09:00:00Z')).toBe('3 時間前')
    expect(formatTime('2025-06-15T11:00:00Z')).toBe('1 時間前')
  })

  it('30 日未満は日', () => {
    expect(formatTime('2025-06-13T12:00:00Z')).toBe('2 日前')
    expect(formatTime('2025-06-14T12:00:00Z')).toBe('1 日前')
  })

  it('12 か月未満は月', () => {
    expect(formatTime('2025-05-15T12:00:00Z')).toBe('1 か月前')
  })

  it('1 年以上は年', () => {
    expect(formatTime('2023-06-15T12:00:00Z')).toBe('2 年前')
  })

  it('epoch ミリ秒も受け付ける', () => {
    expect(formatTime(Date.parse('2025-06-15T11:45:00Z'))).toBe('15 分前')
  })

  it('未来の時刻は「たった今」に丸める', () => {
    expect(formatTime('2025-06-15T12:30:00Z')).toBe('たった今')
  })

  it('現在時刻を渡せる (定期更新する ref に乗せる用)', () => {
    const now = Date.parse('2025-06-15T13:00:00Z')
    expect(formatTime('2025-06-15T12:00:00Z', now)).toBe('1 時間前')
  })

  it('同じ分の中でも 60 秒境界を越えたら表記が変わる', () => {
    // parse 結果ではなくラベルをキャッシュすると、11:59:30 の「たった今」が
    // 12:01 まで居座る
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    expect(formatTime('2025-06-15T11:59:30Z')).toBe('たった今')
    vi.setSystemTime(new Date('2025-06-15T12:00:30Z'))
    expect(formatTime('2025-06-15T11:59:30Z')).toBe('1 分前')
  })

  it('日時として読めない値は空文字', () => {
    expect(formatTime('')).toBe('')
    expect(formatTime('not a date')).toBe('')
    // API が「まだ一度も取得していない」を null で返す面がある (フェデレーション)
    expect(formatTime(null)).toBe('')
    expect(formatTime(undefined)).toBe('')
  })
})

describe('formatAbsoluteTime', () => {
  it('<time> の title に出す絶対時刻を返す', () => {
    // タイムゾーンは実行環境依存なので、年と時刻が入ることだけを見る
    expect(formatAbsoluteTime('2025-06-15T11:45:00Z')).toMatch(/2025/)
    expect(formatAbsoluteTime('2025-06-15T11:45:00Z')).toMatch(/:/)
  })

  it('空文字は空文字のまま返す', () => {
    expect(formatAbsoluteTime('')).toBe('')
    expect(formatAbsoluteTime(null)).toBe('')
  })
})

describe('toDatetimeAttr', () => {
  it('ISO 8601 に正規化する', () => {
    expect(toDatetimeAttr('2025-06-15T11:45:00Z')).toBe(
      '2025-06-15T11:45:00.000Z',
    )
    expect(toDatetimeAttr(Date.parse('2025-06-15T11:45:00Z'))).toBe(
      '2025-06-15T11:45:00.000Z',
    )
  })

  it('読めない値では属性を落とす', () => {
    expect(toDatetimeAttr(null)).toBeUndefined()
    expect(toDatetimeAttr('')).toBeUndefined()
    expect(toDatetimeAttr('not a date')).toBeUndefined()
  })
})

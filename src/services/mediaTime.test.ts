import { describe, expect, it } from 'vitest'
import { formatMediaTime, MEDIA_PLAYBACK_RATES } from './mediaTime'

describe('formatMediaTime (#1214)', () => {
  it('1 時間未満は m:ss', () => {
    expect(formatMediaTime(0)).toBe('0:00')
    expect(formatMediaTime(5.9)).toBe('0:05')
    expect(formatMediaTime(65)).toBe('1:05')
    expect(formatMediaTime(3599)).toBe('59:59')
  })

  it('1 時間以上は h:mm:ss', () => {
    expect(formatMediaTime(3600)).toBe('1:00:00')
    expect(formatMediaTime(3661)).toBe('1:01:01')
  })

  it('長さ未確定 (NaN / Infinity / 負) は 0:00', () => {
    expect(formatMediaTime(Number.NaN)).toBe('0:00')
    expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatMediaTime(-3)).toBe('0:00')
  })
})

describe('MEDIA_PLAYBACK_RATES', () => {
  it('本家と同じ 0.25〜2 倍で 1 倍を含む', () => {
    expect(MEDIA_PLAYBACK_RATES).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2])
  })
})

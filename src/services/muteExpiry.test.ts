import { describe, expect, it } from 'vitest'
import {
  expiredKeys,
  MAX_TIMEOUT_MS,
  nextExpiryDelay,
  parseMutingExpiry,
  partitionMutings,
  SYNC_RETRY_MIN_INTERVAL_MS,
  shouldRetrySync,
} from './muteExpiry'

const NOW = Date.UTC(2026, 9, 18, 6, 0, 0)
const DAY = 86_400_000

describe('parseMutingExpiry: mute/list の期限を UNIX ms に', () => {
  it('ISO 8601 は ms に、null は無期限 (null) に', () => {
    expect(parseMutingExpiry('2026-10-25T06:30:00.000Z')).toBe(
      Date.UTC(2026, 9, 25, 6, 30, 0),
    )
    expect(parseMutingExpiry(null)).toBeNull()
  })

  it('読めない値は無期限扱い (隠したまま)', () => {
    expect(parseMutingExpiry('not-a-date')).toBeNull()
    expect(parseMutingExpiry('')).toBeNull()
  })
})

describe('partitionMutings: 同期結果を手元に入れる要素と予約に分ける', () => {
  it('期限切れは入れず、期限つきは予約に回す', () => {
    const r = partitionMutings(
      [
        { userId: 'forever', expiresAt: null },
        { userId: 'soon', expiresAt: NOW + DAY },
        { userId: 'gone', expiresAt: NOW - 1 },
        { userId: 'edge', expiresAt: NOW },
      ],
      NOW,
    )
    expect(r.active).toEqual(['forever', 'soon'])
    expect(r.expiring).toEqual([{ userId: 'soon', expiresAt: NOW + DAY }])
  })
})

describe('nextExpiryDelay: setTimeout の上限で分割', () => {
  it('上限内はそのまま、超えたら上限で切る、過去なら null', () => {
    expect(nextExpiryDelay(NOW + 1000, NOW)).toBe(1000)
    expect(nextExpiryDelay(NOW + 30 * DAY, NOW)).toBe(MAX_TIMEOUT_MS)
    expect(nextExpiryDelay(NOW, NOW)).toBeNull()
    expect(nextExpiryDelay(NOW - 1, NOW)).toBeNull()
  })
})

describe('expiredKeys: 復帰時の掃除', () => {
  it('期限が過ぎた key だけ返す', () => {
    const m = new Map([
      ['a\nu1', NOW - 1],
      ['a\nu2', NOW + 1],
      ['b\nu1', NOW],
    ])
    expect(expiredKeys(m, NOW)).toEqual(['a\nu1', 'b\nu1'])
  })
})

describe('shouldRetrySync: 失敗した同期の再試行', () => {
  it('認証エラーは再試行しない', () => {
    expect(shouldRetrySync({ at: NOW - DAY, auth: true }, NOW)).toBe(false)
  })

  it('直前の失敗から間隔が空くまで打たない', () => {
    expect(
      shouldRetrySync(
        { at: NOW - SYNC_RETRY_MIN_INTERVAL_MS + 1, auth: false },
        NOW,
      ),
    ).toBe(false)
    expect(
      shouldRetrySync(
        { at: NOW - SYNC_RETRY_MIN_INTERVAL_MS, auth: false },
        NOW,
      ),
    ).toBe(true)
  })

  it('失敗の記録が無ければ打つ', () => {
    expect(shouldRetrySync(undefined, NOW)).toBe(true)
  })
})

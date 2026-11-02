import { describe, expect, it } from 'vitest'
import {
  expiredKeys,
  type LocalMuteOp,
  MAX_TIMEOUT_MS,
  nextExpiryDelay,
  parseMutingExpiry,
  partitionMutings,
  RESYNC_MIN_INTERVAL_MS,
  reconcileIds,
  reconcileMutedUsers,
  SYNC_RETRY_MIN_INTERVAL_MS,
  shouldResync,
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

describe('shouldResync: 同期済みアカウントの取り込み直し (#1268)', () => {
  it('最後の取り込みから間隔が空くまで取り直さない', () => {
    expect(shouldResync(NOW, NOW + RESYNC_MIN_INTERVAL_MS - 1)).toBe(false)
    expect(shouldResync(NOW, NOW + RESYNC_MIN_INTERVAL_MS)).toBe(true)
  })
})

describe('reconcileMutedUsers: 取り込み結果に手元の操作を重ねる (#1268)', () => {
  const started = NOW
  const ops = (
    entries: Record<string, LocalMuteOp>,
  ): ReadonlyMap<string, LocalMuteOp> => new Map(Object.entries(entries))

  it('取り込みを始めた後の操作が勝つ (解除は戻さず、ミュートは期限ごと残す)', () => {
    const server = [
      { userId: 'still', expiresAt: null },
      { userId: 'unmutedLocally', expiresAt: null },
    ]
    const r = reconcileMutedUsers(
      server,
      ops({
        unmutedLocally: { kind: 'unmute', at: started + 1 },
        mutedLocally: { kind: 'mute', at: started + 2, expiresAt: NOW + DAY },
      }),
      started,
    )
    expect(r.entries).toEqual([
      { userId: 'still', expiresAt: null },
      { userId: 'mutedLocally', expiresAt: NOW + DAY },
    ])
    expect(r.unknownExpiry).toEqual([])
    expect(r.staleOps).toEqual([])
  })

  it('取り込みを始める前の操作は捨て、サーバーの結果に従う', () => {
    const r = reconcileMutedUsers(
      [{ userId: 'u', expiresAt: null }],
      ops({
        u: { kind: 'unmute', at: started - 1 },
        v: { kind: 'mute', at: started - 1, expiresAt: null },
      }),
      started,
    )
    expect(r.entries).toEqual([{ userId: 'u', expiresAt: null }])
    expect(r.staleOps).toEqual(['u', 'v'])
  })

  it('期限が分からない手元のミュートは unknown として残し、サーバーが知っていればそちら', () => {
    const r = reconcileMutedUsers(
      [{ userId: 'known', expiresAt: NOW + DAY }],
      ops({
        known: { kind: 'mute', at: started + 1 },
        onlyLocal: { kind: 'mute', at: started + 1 },
      }),
      started,
    )
    expect(r.entries).toEqual([
      { userId: 'known', expiresAt: NOW + DAY },
      { userId: 'onlyLocal', expiresAt: null },
    ])
    expect(r.unknownExpiry).toEqual(['onlyLocal'])
  })
})

describe('reconcileIds: 期限の無い集合 (リノートミュート) の同じ規則', () => {
  it('取り込み後の解除は戻さず、取り込み後のミュートは残し、前の操作は捨てる', () => {
    const r = reconcileIds(
      ['a', 'b'],
      new Map<string, LocalMuteOp>([
        ['b', { kind: 'unmute', at: NOW + 1 }],
        ['c', { kind: 'mute', at: NOW + 1 }],
        ['d', { kind: 'mute', at: NOW - 1 }],
      ]),
      NOW,
    )
    expect(r.ids).toEqual(['a', 'c'])
    expect(r.staleOps).toEqual(['d'])
  })
})

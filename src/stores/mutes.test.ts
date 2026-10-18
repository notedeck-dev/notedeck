import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMutesStore } from './mutes'

const DAY = 86_400_000

describe('期限つきユーザーミュートの手元の解除', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('期限が来たら手元のミュートを外す', () => {
    const m = useMutesStore()
    m.muteUser('a', 'u', Date.now() + DAY)
    vi.advanceTimersByTime(DAY - 1)
    expect(m.isUserMuted('a', 'u')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(m.isUserMuted('a', 'u')).toBe(false)
  })

  it('setTimeout の上限 (約 24.8 日) を超える期限でも外す', () => {
    const m = useMutesStore()
    m.muteUser('a', 'u', Date.now() + 30 * DAY)
    vi.advanceTimersByTime(29 * DAY)
    expect(m.isUserMuted('a', 'u')).toBe(true)
    vi.advanceTimersByTime(DAY)
    expect(m.isUserMuted('a', 'u')).toBe(false)
  })

  it('無期限で再ミュートしたら前の期限では外さない', () => {
    const m = useMutesStore()
    m.muteUser('a', 'u', Date.now() + DAY)
    m.muteUser('a', 'u')
    vi.advanceTimersByTime(2 * DAY)
    expect(m.isUserMuted('a', 'u')).toBe(true)
  })

  it('手動で解除して無期限で付け直したら、前の期限では外さない', () => {
    const m = useMutesStore()
    m.muteUser('a', 'u', Date.now() + DAY)
    m.unmuteUser('a', 'u')
    m.muteUser('a', 'u')
    vi.advanceTimersByTime(2 * DAY)
    expect(m.isUserMuted('a', 'u')).toBe(true)
  })
})

describe('同期で取り込んだ期限つきミュート (#1260)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('同期で入った期限つきは期限で外れ、無期限は残る', () => {
    const m = useMutesStore()
    m.setMutedUsers('a', [
      { userId: 'forever', expiresAt: null },
      { userId: 'soon', expiresAt: Date.now() + DAY },
    ])
    expect(m.isUserMuted('a', 'soon')).toBe(true)
    vi.advanceTimersByTime(DAY)
    expect(m.isUserMuted('a', 'soon')).toBe(false)
    expect(m.isUserMuted('a', 'forever')).toBe(true)
  })

  it('同期の時点で期限が過ぎているものは最初から入れない', () => {
    const m = useMutesStore()
    m.setMutedUsers('a', [{ userId: 'gone', expiresAt: Date.now() - 1 }])
    expect(m.isUserMuted('a', 'gone')).toBe(false)
  })

  it('再同期で古い予約は残らず、新しい期限に置き換わる', () => {
    const m = useMutesStore()
    m.setMutedUsers('a', [{ userId: 'u', expiresAt: Date.now() + DAY }])
    m.setMutedUsers('a', [{ userId: 'u', expiresAt: Date.now() + 3 * DAY }])
    vi.advanceTimersByTime(DAY)
    expect(m.isUserMuted('a', 'u')).toBe(true)
    vi.advanceTimersByTime(2 * DAY)
    expect(m.isUserMuted('a', 'u')).toBe(false)
  })

  it('再同期で一覧から消えた相手の予約も消える (別アカウントは触らない)', () => {
    const m = useMutesStore()
    m.setMutedUsers('a', [{ userId: 'u', expiresAt: Date.now() + DAY }])
    m.setMutedUsers('b', [{ userId: 'u', expiresAt: Date.now() + DAY }])
    m.setMutedUsers('a', [])
    m.muteUser('a', 'u') // 同期後に手で無期限ミュート
    vi.advanceTimersByTime(2 * DAY)
    expect(m.isUserMuted('a', 'u')).toBe(true)
    expect(m.isUserMuted('b', 'u')).toBe(false)
  })

  it('mutedUntil は期限を返し、無期限と未知と期限切れは null', () => {
    const m = useMutesStore()
    const until = Date.now() + DAY
    m.muteUser('a', 'timed', until)
    m.muteUser('a', 'forever')
    expect(m.mutedUntil('a', 'timed')).toBe(until)
    expect(m.mutedUntil('a', 'forever')).toBeNull()
    expect(m.mutedUntil('a', 'unknown')).toBeNull()
    // timer が遅れていても (sweep 前でも) 期限を過ぎた値は出さない
    vi.setSystemTime(until)
    expect(m.mutedUntil('a', 'timed')).toBeNull()
  })

  it('sweepExpired は眠っている間に期限が過ぎたものを外し、残りは予約し直す', () => {
    const m = useMutesStore()
    const now = Date.now()
    m.muteUser('a', 'gone', now + DAY)
    m.muteUser('a', 'later', now + 3 * DAY)
    // スリープ: 壁時計だけ 2 日進む (timer は進まない)
    vi.setSystemTime(now + 2 * DAY)
    const before = m.mutedUsersRemovalVersion
    m.sweepExpired()
    expect(m.isUserMuted('a', 'gone')).toBe(false)
    expect(m.isUserMuted('a', 'later')).toBe(true)
    expect(m.mutedUsersRemovalVersion).toBe(before + 1)
    // 消すものが無ければ version を動かさない (冪等)
    m.sweepExpired()
    expect(m.mutedUsersRemovalVersion).toBe(before + 1)
    // 予約し直した timer は残り 1 日で発火する
    vi.advanceTimersByTime(DAY)
    expect(m.isUserMuted('a', 'later')).toBe(false)
  })

  it('purgeAccount はそのアカウントの集合と予約を捨てる', () => {
    const m = useMutesStore()
    m.muteUser('a', 'u', Date.now() + DAY)
    m.muteUser('b', 'u')
    m.purgeAccount('a')
    expect(m.isUserMuted('a', 'u')).toBe(false)
    expect(m.mutedUntil('a', 'u')).toBeNull()
    expect(m.isUserMuted('b', 'u')).toBe(true)
    expect(() => vi.advanceTimersByTime(2 * DAY)).not.toThrow()
  })

  it('purgeAccount はリノート / インスタンス / ワードミュートも捨てる', () => {
    const m = useMutesStore()
    m.muteRenote('a', 'r')
    m.setMutedInstances('a', ['bad.example'])
    m.setMutedWords('a', [['spam']], [['worse']])
    m.purgeAccount('a')
    expect(m.isRenoteMuted('a', 'r')).toBe(false)
    expect(m.isInstanceMuted('a', 'bad.example')).toBe(false)
    expect(m.matchesSoftWord('a', 'spam')).toBe(false)
    expect(m.matchesHardWord('a', 'worse')).toBe(false)
  })
})

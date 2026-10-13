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

// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  columnTargetId,
  navbarTargetId,
  useSpotlightStore,
} from './useSpotlight'

describe('useSpotlightStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('highlight() で entry が追加され isActive が true になる', () => {
    const store = useSpotlightStore()
    store.highlight('navbar:notifications:null')

    expect(store.isActive('navbar:notifications:null')).toBe(true)
    expect(store.spotlights.has('navbar:notifications:null')).toBe(true)
  })

  it('既定 durationMs (2400ms) 後に自動削除される', () => {
    const store = useSpotlightStore()
    store.highlight('navbar:notifications:null')

    vi.advanceTimersByTime(2399)
    expect(store.isActive('navbar:notifications:null')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(store.isActive('navbar:notifications:null')).toBe(false)
  })

  it('durationMs を指定して任意の期間を設定できる', () => {
    const store = useSpotlightStore()
    store.highlight('navbar:chat:null', { durationMs: 1000 })

    vi.advanceTimersByTime(999)
    expect(store.isActive('navbar:chat:null')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(store.isActive('navbar:chat:null')).toBe(false)
  })

  it('同一 targetId を再 highlight すると expiresAt が更新される (古い timer は新 entry を消さない)', () => {
    const store = useSpotlightStore()
    store.highlight('navbar:notifications:null', { durationMs: 1000 })

    // 500ms 経過: まだ生きている
    vi.advanceTimersByTime(500)
    expect(store.isActive('navbar:notifications:null')).toBe(true)

    // 再 highlight (新しい expiresAt: now+1000)
    store.highlight('navbar:notifications:null', { durationMs: 1000 })

    // 元の timer が fire するタイミング (合計 1000ms)
    vi.advanceTimersByTime(500)
    // 古い timer は expiresAt が一致しないので削除しない
    expect(store.isActive('navbar:notifications:null')).toBe(true)

    // 新 timer が fire する (再 highlight から 1000ms)
    vi.advanceTimersByTime(500)
    expect(store.isActive('navbar:notifications:null')).toBe(false)
  })

  it('clear(targetId) で個別エントリを消せる', () => {
    const store = useSpotlightStore()
    store.highlight('navbar:notifications:null')
    store.highlight('navbar:chat:null')

    store.clear('navbar:notifications:null')

    expect(store.isActive('navbar:notifications:null')).toBe(false)
    expect(store.isActive('navbar:chat:null')).toBe(true)
  })

  it('clear() (引数なし) で全エントリを消せる', () => {
    const store = useSpotlightStore()
    store.highlight('navbar:notifications:null')
    store.highlight('navbar:chat:null')

    store.clear()

    expect(store.spotlights.size).toBe(0)
  })

  it('lastAnnouncement は label 指定時のみ更新される', () => {
    const store = useSpotlightStore()
    expect(store.lastAnnouncement).toBe('')

    store.highlight('navbar:notifications:null', { label: 'AI が通知を追加' })
    expect(store.lastAnnouncement).toBe('AI が通知を追加')

    // label 無しでは更新されない
    store.highlight('navbar:chat:null')
    expect(store.lastAnnouncement).toBe('AI が通知を追加')
  })

  it('複数 targetId が独立に管理される', () => {
    const store = useSpotlightStore()
    store.highlight('navbar:notifications:null', { durationMs: 1000 })
    store.highlight('navbar:chat:null', { durationMs: 2000 })

    vi.advanceTimersByTime(1000)
    expect(store.isActive('navbar:notifications:null')).toBe(false)
    expect(store.isActive('navbar:chat:null')).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(store.isActive('navbar:chat:null')).toBe(false)
  })
})

describe('columnTargetId', () => {
  it('column id を column:<id> 形式で組み立てる', () => {
    expect(columnTargetId('col-1778')).toBe('column:col-1778')
  })
})

describe('navbarTargetId', () => {
  it('accountId が null のとき "null" 文字列を埋め込む', () => {
    expect(navbarTargetId('notifications', null)).toBe(
      'navbar:notifications:null',
    )
  })

  it('accountId が文字列のときそれを埋め込む', () => {
    expect(navbarTargetId('chat', 'abc123')).toBe('navbar:chat:abc123')
  })
})

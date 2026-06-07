import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMuteStore } from '@/stores/mutes'

describe('useMuteStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports a muted user', () => {
    const store = useMuteStore()
    store.mute('acc1', 'u1')
    expect(store.isMuted('acc1', 'u1')).toBe(true)
  })

  it('is scoped per account', () => {
    const store = useMuteStore()
    store.mute('acc1', 'u1')
    expect(store.isMuted('acc2', 'u1')).toBe(false)
  })

  it('restores on unmute', () => {
    const store = useMuteStore()
    store.mute('acc1', 'u1')
    store.unmute('acc1', 'u1')
    expect(store.isMuted('acc1', 'u1')).toBe(false)
  })

  it('replaces the muted set on setMuted (mute/list sync)', () => {
    const store = useMuteStore()
    store.mute('acc1', 'old')
    store.setMuted('acc1', ['a', 'b'])
    expect(store.isMuted('acc1', 'old')).toBe(false)
    expect(store.isMuted('acc1', 'a')).toBe(true)
    expect(store.isMuted('acc1', 'b')).toBe(true)
  })

  it('treats null/undefined userId as not muted', () => {
    const store = useMuteStore()
    expect(store.isMuted('acc1', undefined)).toBe(false)
    expect(store.isMuted('acc1', null)).toBe(false)
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useMutesStore } from '@/stores/mutes'

describe('useMutesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('user mute', () => {
    it('reports a muted user', () => {
      const store = useMutesStore()
      store.muteUser('acc1', 'u1')
      expect(store.isUserMuted('acc1', 'u1')).toBe(true)
    })

    it('is scoped per account', () => {
      const store = useMutesStore()
      store.muteUser('acc1', 'u1')
      expect(store.isUserMuted('acc2', 'u1')).toBe(false)
    })

    it('restores on unmute', () => {
      const store = useMutesStore()
      store.muteUser('acc1', 'u1')
      store.unmuteUser('acc1', 'u1')
      expect(store.isUserMuted('acc1', 'u1')).toBe(false)
    })

    it('replaces the muted set on setMutedUsers (mute/list sync)', () => {
      const store = useMutesStore()
      store.muteUser('acc1', 'old')
      store.setMutedUsers('acc1', [
        { userId: 'a', expiresAt: null },
        { userId: 'b', expiresAt: null },
      ])
      expect(store.isUserMuted('acc1', 'old')).toBe(false)
      expect(store.isUserMuted('acc1', 'a')).toBe(true)
      expect(store.isUserMuted('acc1', 'b')).toBe(true)
    })

    it('treats null/undefined userId as not muted', () => {
      const store = useMutesStore()
      expect(store.isUserMuted('acc1', undefined)).toBe(false)
      expect(store.isUserMuted('acc1', null)).toBe(false)
    })
  })

  describe('renote mute', () => {
    it('keeps a separate set from user mute', () => {
      const store = useMutesStore()
      store.muteRenote('acc1', 'u1')
      expect(store.isRenoteMuted('acc1', 'u1')).toBe(true)
      expect(store.isUserMuted('acc1', 'u1')).toBe(false)

      store.unmuteRenote('acc1', 'u1')
      expect(store.isRenoteMuted('acc1', 'u1')).toBe(false)
    })

    it('replaces the set on setMutedRenoters (renote-mute/list sync)', () => {
      const store = useMutesStore()
      store.muteRenote('acc1', 'old')
      store.setMutedRenoters('acc1', ['x'])
      expect(store.isRenoteMuted('acc1', 'old')).toBe(false)
      expect(store.isRenoteMuted('acc1', 'x')).toBe(true)
    })
  })

  describe('instance mute', () => {
    it('hydrates via setMutedInstances and matches by host', () => {
      const store = useMutesStore()
      store.setMutedInstances('acc1', ['bad.example'])
      expect(store.isInstanceMuted('acc1', 'bad.example')).toBe(true)
      expect(store.isInstanceMuted('acc1', 'good.example')).toBe(false)
      expect(store.isInstanceMuted('acc2', 'bad.example')).toBe(false)
      expect(store.isInstanceMuted('acc1', null)).toBe(false)
    })
  })

  describe('word mute', () => {
    it('matches hard and soft words after sync', () => {
      const store = useMutesStore()
      store.setMutedWords('acc1', [['spoiler']], [['banned']])
      expect(store.matchesSoftWord('acc1', 'a spoiler appears')).toBe(true)
      expect(store.matchesHardWord('acc1', 'a spoiler appears')).toBe(false)
      expect(store.matchesHardWord('acc1', 'banned content')).toBe(true)
    })

    it('is scoped per account', () => {
      const store = useMutesStore()
      store.setMutedWords('acc1', [['x']], [])
      expect(store.matchesSoftWord('acc2', 'x here')).toBe(false)
    })

    it('replaces words on re-sync and reflects removal', () => {
      const store = useMutesStore()
      store.setMutedWords('acc1', [['old']], [])
      expect(store.matchesSoftWord('acc1', 'old word')).toBe(true)
      store.setMutedWords('acc1', [['new']], [])
      expect(store.matchesSoftWord('acc1', 'old word')).toBe(false)
      expect(store.matchesSoftWord('acc1', 'new word')).toBe(true)
    })

    it('returns false when account has no words or is missing', () => {
      const store = useMutesStore()
      expect(store.matchesSoftWord('acc1', 'anything')).toBe(false)
      expect(store.matchesHardWord(null, 'anything')).toBe(false)
    })
  })
})

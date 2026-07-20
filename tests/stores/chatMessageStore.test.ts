import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/adapters/types'
import { useChatMessageStore } from '@/stores/chatMessageStore'
import { usePerformanceStore } from '@/stores/performance'

function makeMessage(id: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    createdAt: `2026-01-01T00:00:00.${id.padStart(3, '0')}Z`,
    fromUserId: 'u1',
    text: `msg ${id}`,
    ...over,
  }
}

const reactor = {
  id: 'u2',
  username: 'bob',
  name: null,
  host: null,
  avatarUrl: null,
}

describe('useChatMessageStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('put / get / resolve', () => {
    it('put stores messages and resolve returns them in id order, skipping unknown ids', () => {
      const store = useChatMessageStore()
      store.put([makeMessage('1'), makeMessage('2')])
      const resolved = store.resolve(['2', 'missing', '1'])
      expect(resolved.map((m) => m.id)).toEqual(['2', '1'])
    })

    it('get returns the message and refreshes LRU insertion order', () => {
      const store = useChatMessageStore()
      store.put([makeMessage('1'), makeMessage('2'), makeMessage('3')])
      expect(store.get('1')?.id).toBe('1')
      // LRU refresh: 直近アクセスが insertion order の末尾に来る
      expect([...store.messageMap.keys()]).toEqual(['2', '3', '1'])
    })

    it('update replaces a stored message', () => {
      const store = useChatMessageStore()
      store.put([makeMessage('1')])
      store.update('1', makeMessage('1', { text: 'edited' }))
      expect(store.get('1')?.text).toBe('edited')
    })
  })

  describe('remove / onDelete', () => {
    it('remove deletes the message and notifies delete listeners', () => {
      const store = useChatMessageStore()
      const listener = vi.fn()
      store.onDelete(listener)
      store.put([makeMessage('1')])
      store.remove('1')
      expect(store.get('1')).toBeUndefined()
      expect(listener).toHaveBeenCalledWith('1')
    })

    it('onDelete unsubscribe stops notifications', () => {
      const store = useChatMessageStore()
      const listener = vi.fn()
      const off = store.onDelete(listener)
      off()
      store.put([makeMessage('1')])
      store.remove('1')
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('applyUpdate', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('deleted removes the message and notifies listeners', () => {
      const store = useChatMessageStore()
      const listener = vi.fn()
      store.onDelete(listener)
      store.put([makeMessage('1')])
      store.applyUpdate({ type: 'deleted', messageId: '1' })
      expect(store.get('1')).toBeUndefined()
      expect(listener).toHaveBeenCalledWith('1')
    })

    it('reacted appends a reaction and normalizes reactor null fields to undefined', () => {
      const store = useChatMessageStore()
      store.put([makeMessage('1')])
      store.applyUpdate({
        type: 'reacted',
        messageId: '1',
        userId: 'u2',
        reaction: '👍',
        reactor,
      })
      const reactions = store.get('1')?.reactions
      expect(reactions).toHaveLength(1)
      expect(reactions?.[0]?.reaction).toBe('👍')
      expect(reactions?.[0]?.user?.id).toBe('u2')
      expect(reactions?.[0]?.user?.name).toBeUndefined()
      expect(reactions?.[0]?.user?.host).toBeUndefined()
    })

    it('reacted without reactor stores a null user', () => {
      const store = useChatMessageStore()
      store.put([makeMessage('1')])
      store.applyUpdate({
        type: 'reacted',
        messageId: '1',
        userId: 'u2',
        reaction: '👍',
      })
      expect(store.get('1')?.reactions?.[0]?.user).toBeNull()
    })

    it('dedups an identical event within the dedup window', () => {
      const store = useChatMessageStore()
      store.put([makeMessage('1')])
      const event = {
        type: 'reacted',
        messageId: '1',
        userId: 'u2',
        reaction: '👍',
        reactor,
      } as const
      store.applyUpdate(event)
      store.applyUpdate(event)
      expect(store.get('1')?.reactions).toHaveLength(1)
    })

    it('applies the same event again after the dedup window expires', () => {
      const store = useChatMessageStore()
      store.put([makeMessage('1')])
      const event = {
        type: 'reacted',
        messageId: '1',
        userId: 'u2',
        reaction: '👍',
        reactor,
      } as const
      store.applyUpdate(event)
      vi.advanceTimersByTime(1600)
      store.applyUpdate(event)
      expect(store.get('1')?.reactions).toHaveLength(2)
    })

    it('an event for an unloaded message is not recorded for dedup and applies after load', () => {
      const store = useChatMessageStore()
      const event = {
        type: 'reacted',
        messageId: '1',
        userId: 'u2',
        reaction: '👍',
        reactor,
      } as const
      // メッセージ未ロード時のイベントは捨てられるが、dedup 署名も残さない
      store.applyUpdate(event)
      store.put([makeMessage('1')])
      // ロード直後の再配送（dedup window 内）は適用される
      store.applyUpdate(event)
      expect(store.get('1')?.reactions).toHaveLength(1)
    })

    it('an event with a different signature is not deduped', () => {
      const store = useChatMessageStore()
      store.put([makeMessage('1')])
      store.applyUpdate({
        type: 'reacted',
        messageId: '1',
        userId: 'u2',
        reaction: '👍',
        reactor,
      })
      store.applyUpdate({
        type: 'reacted',
        messageId: '1',
        userId: 'u2',
        reaction: '❤',
        reactor,
      })
      expect(store.get('1')?.reactions).toHaveLength(2)
    })

    it('unreacted removes only the first matching (userId, reaction) entry', () => {
      const store = useChatMessageStore()
      store.put([
        makeMessage('1', {
          reactions: [
            { user: { id: 'u2', username: 'bob' }, reaction: '👍' },
            { user: { id: 'u2', username: 'bob' }, reaction: '👍' },
            { user: { id: 'u3', username: 'eve' }, reaction: '👍' },
          ],
        }),
      ])
      store.applyUpdate({
        type: 'unreacted',
        messageId: '1',
        userId: 'u2',
        reaction: '👍',
      })
      const reactions = store.get('1')?.reactions
      expect(reactions).toHaveLength(2)
      expect(reactions?.map((r) => r.user?.id)).toEqual(['u2', 'u3'])
    })

    it('unreacted matches a null user against a missing userId', () => {
      const store = useChatMessageStore()
      store.put([
        makeMessage('1', { reactions: [{ user: null, reaction: '👍' }] }),
      ])
      store.applyUpdate({ type: 'unreacted', messageId: '1', reaction: '👍' })
      expect(store.get('1')?.reactions).toHaveLength(0)
    })

    it('unreacted is a no-op when no entry matches', () => {
      const store = useChatMessageStore()
      store.put([
        makeMessage('1', {
          reactions: [{ user: { id: 'u2', username: 'bob' }, reaction: '👍' }],
        }),
      ])
      store.applyUpdate({
        type: 'unreacted',
        messageId: '1',
        userId: 'u9',
        reaction: '👍',
      })
      expect(store.get('1')?.reactions).toHaveLength(1)
    })

    it('does not throw for updates targeting an unknown message', () => {
      const store = useChatMessageStore()
      expect(() =>
        store.applyUpdate({
          type: 'reacted',
          messageId: 'missing',
          userId: 'u2',
          reaction: '👍',
        }),
      ).not.toThrow()
    })
  })

  describe('eviction (chatMessageStoreMax)', () => {
    function setMax(max: number) {
      const perf = usePerformanceStore()
      perf.overrides = { chatMessageStoreMax: max }
    }

    it('evicts oldest non-live messages beyond the max', () => {
      setMax(3)
      const store = useChatMessageStore()
      store.put([
        makeMessage('1'),
        makeMessage('2'),
        makeMessage('3'),
        makeMessage('4'),
      ])
      expect([...store.messageMap.keys()]).toEqual(['2', '3', '4'])
    })

    it('protects ids referenced by a registered root', () => {
      setMax(3)
      const store = useChatMessageStore()
      store.registerRoot(() => ['1'])
      store.put([
        makeMessage('1'),
        makeMessage('2'),
        makeMessage('3'),
        makeMessage('4'),
      ])
      expect([...store.messageMap.keys()]).toEqual(['1', '3', '4'])
    })

    it('unregistering a root makes its ids evictable again', () => {
      setMax(3)
      const store = useChatMessageStore()
      const unregister = store.registerRoot(() => ['1'])
      store.put([
        makeMessage('1'),
        makeMessage('2'),
        makeMessage('3'),
        makeMessage('4'),
      ])
      unregister()
      store.put([makeMessage('5')])
      expect([...store.messageMap.keys()]).toEqual(['3', '4', '5'])
    })

    it('falls back to createdAt order when every message is live', () => {
      setMax(3)
      const store = useChatMessageStore()
      store.registerRoot(() => ['1', '2', '3', '4'])
      store.put([
        makeMessage('4'),
        makeMessage('2'),
        makeMessage('1'),
        makeMessage('3'),
      ])
      // createdAt が最古の '1' が削除される (insertion order ではなく)
      expect(store.messageMap.size).toBe(3)
      expect(store.get('1')).toBeUndefined()
    })
  })
})

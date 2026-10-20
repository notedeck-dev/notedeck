import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/adapters/types'
import { useChatVisibility } from '@/composables/useChatVisibility'
import { useMutesStore } from '@/stores/mutes'

function makeMessage(fromUserId: string): ChatMessage {
  return {
    id: 'm1',
    _accountId: 'acc',
    createdAt: '2026-01-01T00:00:00.000Z',
    fromUserId,
    text: 'hi',
  }
}

describe('useChatVisibility', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reports a muted DM partner, restores on unmute', () => {
    const muteStore = useMutesStore()
    const { isPartnerMuted } = useChatVisibility()
    expect(isPartnerMuted('acc1', 'muted-user')).toBe(false)

    muteStore.muteUser('acc1', 'muted-user')
    expect(isPartnerMuted('acc1', 'muted-user')).toBe(true)

    muteStore.unmuteUser('acc1', 'muted-user')
    expect(isPartnerMuted('acc1', 'muted-user')).toBe(false)
  })

  it('hides a message from a muted sender', () => {
    const muteStore = useMutesStore()
    const { isMessageHidden } = useChatVisibility()
    const msg = makeMessage('muted-user')
    expect(isMessageHidden('acc1', msg)).toBe(false)

    muteStore.muteUser('acc1', 'muted-user')
    expect(isMessageHidden('acc1', msg)).toBe(true)
  })

  it('scopes mute per account', () => {
    const muteStore = useMutesStore()
    const { isPartnerMuted, isMessageHidden } = useChatVisibility()
    muteStore.muteUser('acc2', 'u9')
    expect(isPartnerMuted('acc1', 'u9')).toBe(false)
    expect(isMessageHidden('acc1', makeMessage('u9'))).toBe(false)
  })

  it('returns false when account context is missing', () => {
    const muteStore = useMutesStore()
    const { isPartnerMuted, isMessageHidden } = useChatVisibility()
    muteStore.muteUser('acc1', 'u9')
    expect(isPartnerMuted(null, 'u9')).toBe(false)
    expect(isPartnerMuted(undefined, 'u9')).toBe(false)
    expect(isMessageHidden(null, makeMessage('u9'))).toBe(false)
  })
})

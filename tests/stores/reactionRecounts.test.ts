import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useMutesStore } from '@/stores/mutes'
import {
  RECOUNT_MAX_TOTAL,
  useReactionRecountsStore,
} from '@/stores/reactionRecounts'

const getNoteReactionsMock = vi.fn()

vi.mock('@/adapters/factory', () => ({
  initAdapterFor: async () => ({
    adapter: { api: { getNoteReactions: getNoteReactionsMock } },
  }),
}))

vi.mock('@/stores/accounts', () => ({
  useAccountsStore: () => ({
    accounts: [{ id: 'acc1', host: 'example.com', hasToken: true }],
  }),
}))

function record(type: string, userId: string) {
  return { id: `${type}-${userId}`, type, user: { id: userId } }
}

describe('useReactionRecountsStore (#575)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getNoteReactionsMock.mockReset()
  })

  it('fetches the visible listing and recounts (server-side exclusion)', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    const serverCounts = { '❤': 2 }
    await store.ensure('acc1', 'note1', serverCounts)
    expect(store.get('acc1', 'note1', serverCounts)).toEqual({ '❤': 1 })
  })

  it('invalidates when server counts change (signature mismatch)', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'note1', { '❤': 2 })
    expect(store.get('acc1', 'note1', { '❤': 3 })).toBeNull()
  })

  it('skips fetching when total exceeds the cost limit', async () => {
    const store = useReactionRecountsStore()
    const serverCounts = { '❤': RECOUNT_MAX_TOTAL + 1 }
    await store.ensure('acc1', 'note1', serverCounts)
    expect(getNoteReactionsMock).not.toHaveBeenCalled()
    expect(store.get('acc1', 'note1', serverCounts)).toBeNull()
  })

  it('reflects a newly muted user instantly without refetch', async () => {
    getNoteReactionsMock.mockResolvedValue([
      record('❤', 'u1'),
      record('❤', 'u2'),
    ])
    const store = useReactionRecountsStore()
    const serverCounts = { '❤': 2 }
    await store.ensure('acc1', 'note1', serverCounts)
    expect(store.get('acc1', 'note1', serverCounts)).toEqual({ '❤': 2 })

    useMutesStore().muteUser('acc1', 'u2')
    await nextTick()
    // キャッシュは維持されたまま、クライアント照合で即時に差し引かれる
    expect(getNoteReactionsMock).toHaveBeenCalledTimes(1)
    expect(store.get('acc1', 'note1', serverCounts)).toEqual({ '❤': 1 })
  })

  it('purges cache on unmute so the listing is refetched', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    const serverCounts = { '❤': 2 }
    await store.ensure('acc1', 'note1', serverCounts)
    expect(store.get('acc1', 'note1', serverCounts)).toEqual({ '❤': 1 })

    const mutes = useMutesStore()
    mutes.muteUser('acc1', 'u9')
    mutes.unmuteUser('acc1', 'u9')
    await nextTick()
    expect(store.get('acc1', 'note1', serverCounts)).toBeNull()
  })
})

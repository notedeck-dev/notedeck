import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useMutesStore } from '@/stores/mutes'
import {
  RECOUNT_MAX_TOTAL,
  useReactionRecountsStore,
} from '@/stores/reactionRecounts'

const getNoteReactionsMock = vi.fn()
const probeMock = vi.fn()
const suspendedIds = new Set<string>()

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

vi.mock('@/stores/suspensions', () => ({
  useSuspensionsStore: () => ({
    isSuspended: (_accountId: string, userId: string) =>
      suspendedIds.has(userId),
    probe: probeMock,
  }),
}))

function record(type: string, userId: string) {
  return { id: `${type}-${userId}`, type, user: { id: userId } }
}

describe('useReactionRecountsStore (#575)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getNoteReactionsMock.mockReset()
    probeMock.mockReset()
    suspendedIds.clear()
  })

  it('fetches the visible listing and recounts (server-side exclusion)', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    const serverCounts = { '❤': 2 }
    await store.ensure('acc1', 'note1', serverCounts)
    expect(store.get('acc1', 'note1', serverCounts)).toEqual({ '❤': 1 })
  })

  it('serves stale recount while server counts change (no flicker)', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'note1', { '❤': 2 })
    // signature が変わっても null に落とさず stale を返す (ミュート絵文字の一瞬復活を防ぐ)
    expect(store.get('acc1', 'note1', { '❤': 3 })).toEqual({ '❤': 1 })
  })

  it('falls back to server counts when total grows beyond the limit', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'note1', { '❤': 2 })
    expect(
      store.get('acc1', 'note1', { '❤': RECOUNT_MAX_TOTAL + 1 }),
    ).toBeNull()
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

  it('probes reactors for suspension and hides them once detected', async () => {
    getNoteReactionsMock.mockResolvedValue([
      record('❤', 'u1'),
      record(':gomennasai@.:', 'frozen1'),
    ])
    const store = useReactionRecountsStore()
    const serverCounts = { '❤': 1, ':gomennasai@.:': 1 }
    await store.ensure('acc1', 'note1', serverCounts)
    // 列挙のリアクターは凍結検知 (#828) の probe に回される
    expect(probeMock).toHaveBeenCalledWith('acc1', ['u1', 'frozen1'])

    // probe が凍結を検知したら refetch なしで即時に差し引かれる
    suspendedIds.add('frozen1')
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

/**
 * リアクションが 1 個増えるだけで signature は変わる。抑制が無いと流速の速い
 * TL で可視ノートぶんの `notes/reactions` を連射し、そのリアクター全員が
 * 凍結検知の `users/show` へ流れて増幅する (Android で強制終了する経路)。
 */
describe('useReactionRecountsStore: refetch cooldown (#575)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    getNoteReactionsMock.mockReset()
    probeMock.mockReset()
    suspendedIds.clear()
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not refetch while reactions keep arriving within the cooldown', async () => {
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'note1', { '❤': 1 })
    expect(getNoteReactionsMock).toHaveBeenCalledTimes(1)

    for (const n of [2, 3, 4, 5]) {
      await vi.advanceTimersByTimeAsync(250)
      await store.ensure('acc1', 'note1', { '❤': n })
    }

    expect(getNoteReactionsMock).toHaveBeenCalledTimes(1)
  })

  it('refetches once with the latest counts after the cooldown', async () => {
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'note1', { '❤': 1 })
    for (const n of [2, 3, 4, 5]) {
      await store.ensure('acc1', 'note1', { '❤': n })
    }
    expect(getNoteReactionsMock).toHaveBeenCalledTimes(1)

    getNoteReactionsMock.mockResolvedValue([
      record('❤', 'u1'),
      record('❤', 'u2'),
    ])
    await vi.advanceTimersByTimeAsync(6000)

    // 途中のカウントは捨てられ、最新の 1 回だけが飛ぶ
    expect(getNoteReactionsMock).toHaveBeenCalledTimes(2)
    expect(store.get('acc1', 'note1', { '❤': 5 })).toEqual({ '❤': 2 })
  })

  it('does not share the cooldown across notes', async () => {
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'note1', { '❤': 1 })
    await store.ensure('acc1', 'note2', { '❤': 1 })

    expect(getNoteReactionsMock).toHaveBeenCalledTimes(2)
  })
})

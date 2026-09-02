import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useMutesStore } from '@/stores/mutes'
import {
  RECOUNT_CACHE_CAP,
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

describe('useReactionRecountsStore.isPending (#1081)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getNoteReactionsMock.mockReset()
    probeMock.mockReset()
    suspendedIds.clear()
  })

  it('未取得の対象ノートは pending — 描画を保留させる', () => {
    const store = useReactionRecountsStore()
    expect(store.isPending('n1', { '❤': 2 })).toBe(true)
  })

  it('リアクション 0 件・総数超過は対象外なので pending にならない', () => {
    const store = useReactionRecountsStore()
    expect(store.isPending('n1', {})).toBe(false)
    expect(store.isPending('n1', { '❤': RECOUNT_MAX_TOTAL + 1 })).toBe(false)
  })

  it('取得成功で pending が解け、数え直し値が返る', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'n1', { '❤': 2 })
    expect(store.isPending('n1', { '❤': 2 })).toBe(false)
    expect(store.get('acc1', 'n1', { '❤': 2 })).toEqual({ '❤': 1 })
  })

  it('取得失敗でも pending が解け、サーバー集計へフォールバックする', async () => {
    getNoteReactionsMock.mockRejectedValue(new Error('network'))
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'n1', { '❤': 2 })
    expect(store.isPending('n1', { '❤': 2 })).toBe(false)
    expect(store.get('acc1', 'n1', { '❤': 2 })).toBeNull()
  })

  it('アカウント不明でも pending が解ける (フォールバック確定)', async () => {
    const store = useReactionRecountsStore()
    await store.ensure('acc-gone', 'n1', { '❤': 1 })
    expect(store.isPending('n1', { '❤': 1 })).toBe(false)
    expect(store.get('acc-gone', 'n1', { '❤': 1 })).toBeNull()
  })

  it('LRU 破棄されたノートは pending に戻らない (サーバー集計へフォールバック)', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'n0', { '❤': 1 })
    // キャッシュを溢れさせて n0 を追い出す
    for (let i = 1; i <= RECOUNT_CACHE_CAP; i++) {
      await store.ensure('acc1', `spill-${i}`, { '❤': 1 })
    }
    expect(store.get('acc1', 'n0', { '❤': 1 })).toBeNull()
    // pending に戻すと evict → refetch → evict の自己増幅ループになるため、
    // 一度取得が完了したノートは集計表示へフォールバックする
    expect(store.isPending('n0', { '❤': 1 })).toBe(false)
  })

  it('purgeAll は settled 履歴ごと消して pending に戻す (ミュート解除の取り直し)', async () => {
    getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
    const store = useReactionRecountsStore()
    await store.ensure('acc1', 'n1', { '❤': 1 })
    expect(store.isPending('n1', { '❤': 1 })).toBe(false)
    store.purgeAll()
    expect(store.isPending('n1', { '❤': 1 })).toBe(true)
  })
})

/**
 * #1084 レビュー: 一時的な状況 (ネットワーク失敗 / unmute と fetch の race)
 * が恒久状態としてキャッシュに固定され、抹消 (#575) が黙って無効化される
 * 系の回帰テスト。
 */
describe('useReactionRecountsStore: 失敗の回復と purge の race (#1084)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getNoteReactionsMock.mockReset()
    probeMock.mockReset()
    suspendedIds.clear()
  })

  it('初回失敗は確定するが恒久化しない — クールダウン明けに再試行して回復する', async () => {
    vi.useFakeTimers()
    try {
      getNoteReactionsMock.mockRejectedValueOnce(new Error('network'))
      getNoteReactionsMock.mockResolvedValue([record('❤', 'u1')])
      const store = useReactionRecountsStore()
      const serverCounts = { '❤': 2 }
      await store.ensure('acc1', 'note1', serverCounts)
      // 失敗はフォールバックで確定 (隠れたまま固まらない)
      expect(store.isPending('note1', serverCounts)).toBe(false)
      expect(store.get('acc1', 'note1', serverCounts)).toBeNull()

      // 同じ serverCounts でもクールダウン明けに取り直され、回復する
      await store.ensure('acc1', 'note1', serverCounts)
      await vi.advanceTimersByTimeAsync(6000)
      expect(store.get('acc1', 'note1', serverCounts)).toEqual({ '❤': 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('取り直しの失敗は手元の正常な列挙を捨てない (stale-while-revalidate)', async () => {
    vi.useFakeTimers()
    try {
      getNoteReactionsMock.mockResolvedValueOnce([record('❤', 'u1')])
      const store = useReactionRecountsStore()
      await store.ensure('acc1', 'note1', { '❤': 2 })
      expect(store.get('acc1', 'note1', { '❤': 2 })).toEqual({ '❤': 1 })

      // クールダウン明けの取り直しが失敗しても、数え直し値は生きたまま
      await vi.advanceTimersByTimeAsync(6000)
      getNoteReactionsMock.mockRejectedValueOnce(new Error('network'))
      await store.ensure('acc1', 'note1', { '❤': 3 })
      expect(store.get('acc1', 'note1', { '❤': 3 })).toEqual({ '❤': 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('purge をまたいだ応答は捨てられ、最新の列挙で取り直される', async () => {
    // ミュート解除前に発射された列挙 (解除したユーザーを除外済み) が
    // purge 後に確定すると、取り直し不能なまま抹消が固定される
    let resolveStale: (v: unknown) => void = () => {
      // mock の executor が同期実行された時点で必ず上書きされる
    }
    getNoteReactionsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve
        }),
    )
    getNoteReactionsMock.mockResolvedValue([
      record('❤', 'u1'),
      record('❤', 'u2'),
    ])
    const store = useReactionRecountsStore()
    const serverCounts = { '❤': 2 }
    const stale = store.ensure('acc1', 'note1', serverCounts)
    // 列挙リクエストが飛んでから (in-flight になってから) purge する
    await vi.waitFor(() => expect(getNoteReactionsMock).toHaveBeenCalled())

    store.purgeAll()
    resolveStale([record('❤', 'u1')])
    await stale

    // 古い応答 (u2 なし) は書き戻されず、取り直しの結果で確定する
    await vi.waitFor(() => {
      expect(store.get('acc1', 'note1', serverCounts)).toEqual({ '❤': 2 })
    })
    expect(store.isPending('note1', serverCounts)).toBe(false)
  })
})

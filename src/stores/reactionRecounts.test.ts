import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RECOUNT_CACHE_CAP,
  RECOUNT_MAX_TOTAL,
  useReactionRecountsStore,
} from '@/stores/reactionRecounts'

const api = vi.hoisted(() => ({ getNoteReactions: vi.fn() }))

vi.mock('@/adapters/factory', () => ({
  initAdapterFor: () =>
    Promise.resolve({
      adapter: { api: { getNoteReactions: api.getNoteReactions } },
    }),
}))

vi.mock('@/stores/accounts', () => ({
  useAccountsStore: () => ({
    accounts: [{ id: 'acc1', host: 'example.com', hasToken: true }],
  }),
}))

vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, name: string) => {
        // suspensions の probe は「応答から欠落 = 凍結」判定なので、
        // 全員生存を返して誤って凍結扱いされないようにする
        if (name === 'apiProbeUsersSuspended') {
          return (_acc: string, ids: string[]) =>
            Promise.resolve({
              status: 'ok',
              data: ids.map((id) => ({ id, isSuspended: false })),
            })
        }
        return () => Promise.resolve({ status: 'ok', data: [] })
      },
    },
  ),
}))

function reactor(type: string, userId: string) {
  return { type, user: { id: userId } }
}

let store: ReturnType<typeof useReactionRecountsStore>

beforeEach(() => {
  setActivePinia(createPinia())
  api.getNoteReactions.mockReset()
  store = useReactionRecountsStore()
})

describe('useReactionRecountsStore.isPending (#1081)', () => {
  it('未取得の対象ノートは pending — 描画を保留させる', () => {
    expect(store.isPending('n1', { '❤': 2 })).toBe(true)
  })

  it('リアクション 0 件は取得対象外なので pending にならない', () => {
    expect(store.isPending('n1', {})).toBe(false)
  })

  it('総数が上限を超えるノートは対象外なので pending にならない', () => {
    expect(store.isPending('n1', { '❤': RECOUNT_MAX_TOTAL + 1 })).toBe(false)
  })

  it('取得成功で pending が解け、数え直し値が返る', async () => {
    api.getNoteReactions.mockResolvedValue([reactor('❤', 'u1')])
    await store.ensure('acc1', 'n1', { '❤': 2 })
    expect(store.isPending('n1', { '❤': 2 })).toBe(false)
    expect(store.get('acc1', 'n1', { '❤': 2 })).toEqual({ '❤': 1 })
  })

  it('取得失敗でも pending が解け、サーバー集計へフォールバックする', async () => {
    api.getNoteReactions.mockRejectedValue(new Error('network'))
    await store.ensure('acc1', 'n1', { '❤': 2 })
    expect(store.isPending('n1', { '❤': 2 })).toBe(false)
    expect(store.get('acc1', 'n1', { '❤': 2 })).toBeNull()
  })

  it('アカウント不明でも pending が解ける (フォールバック確定)', async () => {
    await store.ensure('acc-gone', 'n1', { '❤': 1 })
    expect(store.isPending('n1', { '❤': 1 })).toBe(false)
    expect(store.get('acc-gone', 'n1', { '❤': 1 })).toBeNull()
  })

  it('LRU 破棄されたノートは pending に戻らない (サーバー集計へフォールバック)', async () => {
    api.getNoteReactions.mockResolvedValue([reactor('❤', 'u1')])
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
    api.getNoteReactions.mockResolvedValue([reactor('❤', 'u1')])
    await store.ensure('acc1', 'n1', { '❤': 1 })
    expect(store.isPending('n1', { '❤': 1 })).toBe(false)
    store.purgeAll()
    expect(store.isPending('n1', { '❤': 1 })).toBe(true)
  })
})

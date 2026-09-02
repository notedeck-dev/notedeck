import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useVisibleReactionCounts } from '@/composables/useVisibleReactionCounts'
import { useReactionRecountsStore } from '@/stores/reactionRecounts'

const api = vi.hoisted(() => ({ getNoteReactions: vi.fn() }))
const state = vi.hoisted(() => ({ hideMuted: true }))

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

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    get: (key: string) =>
      key === 'mute.hideMutedUserReactions' ? state.hideMuted : undefined,
  }),
}))

vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, name: string) => {
        // suspensions の probe は「応答から欠落 = 凍結」判定なので全員生存を返す
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

const NOTE = { id: 'n1', reactions: { '❤': 2 }, _accountId: 'acc1' }

beforeEach(() => {
  setActivePinia(createPinia())
  api.getNoteReactions.mockReset()
  api.getNoteReactions.mockResolvedValue([
    { type: '❤', user: { id: 'u1' } },
    { type: '❤', user: { id: 'u2' } },
  ])
  state.hideMuted = true
})

describe('useVisibleReactionCounts (#1081)', () => {
  it('マウント時は pending、列挙取得が終わると解けて counts が返る', async () => {
    const { pending, counts } = useVisibleReactionCounts(() => NOTE)
    expect(pending.value).toBe(true)
    expect(counts.value).toBeNull()
    await vi.waitFor(() => expect(pending.value).toBe(false))
    expect(counts.value).toEqual({ '❤': 2 })
  })

  it('トグル OFF なら pending にならない (サーバー集計を即表示)', () => {
    state.hideMuted = false
    const { pending } = useVisibleReactionCounts(() => NOTE)
    expect(pending.value).toBe(false)
  })

  it('purge で pending に戻ったら列挙を取り直す (保留のまま固まらない)', async () => {
    const recountsStore = useReactionRecountsStore()
    const { pending } = useVisibleReactionCounts(() => NOTE)
    await vi.waitFor(() => expect(pending.value).toBe(false))
    expect(api.getNoteReactions).toHaveBeenCalledTimes(1)

    // mutedUsersRemovalVersion は変えず、pending 復帰だけで駆動されることを確認
    recountsStore.purgeAll()
    await nextTick()
    await vi.waitFor(() => expect(pending.value).toBe(false))
    expect(api.getNoteReactions).toHaveBeenCalledTimes(2)
  })
})

describe('useVisibleReactionCounts.displayCounts (#1084 レビュー)', () => {
  it('保留中は未フィルタのサーバー集計をどの count にも出さない (自分の分だけ 1)', async () => {
    const noteWithMine = {
      id: 'n-mine',
      reactions: { '❤': 12, '🎉': 3 },
      myReaction: '❤',
      _accountId: 'acc1',
    }
    const { displayCounts, counts, pending } = useVisibleReactionCounts(
      () => noteWithMine,
    )
    expect(pending.value).toBe(true)
    // 12 (未フィルタ) を出すと settle で縮んでミュートユーザーの存在が漏れる
    expect(displayCounts.value).toEqual({ '❤': 1 })

    await vi.waitFor(() => expect(pending.value).toBe(false))
    expect(displayCounts.value).toEqual(counts.value)
  })

  it('保留中で自分のリアクションがなければ空 (チップなし + 高さ予約は面側)', () => {
    const { displayCounts, pending } = useVisibleReactionCounts(() => NOTE)
    expect(pending.value).toBe(true)
    expect(displayCounts.value).toEqual({})
  })

  it('トグル OFF ならサーバー集計をそのまま返す', () => {
    state.hideMuted = false
    const { displayCounts } = useVisibleReactionCounts(() => NOTE)
    expect(displayCounts.value).toEqual(NOTE.reactions)
  })
})

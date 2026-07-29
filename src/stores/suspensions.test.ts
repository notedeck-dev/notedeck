import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import { useNoteList } from '@/composables/useNoteList'
import { useSuspensionsStore } from '@/stores/suspensions'

const api = vi.hoisted(() => ({ getUserRaw: vi.fn() }))

vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === 'apiGetUserRaw') {
          return (accountId: string, params: unknown) =>
            api.getUserRaw(accountId, params)
        }
        return () => Promise.resolve({ status: 'ok', data: [] })
      },
    },
  ),
}))

const HOUR = 60 * 60_000

/** デバウンス + 逐次 chunk の完了まで進める */
async function settle() {
  await vi.advanceTimersByTimeAsync(1000)
}

function ok(users: { id: string; isSuspended?: boolean }[]) {
  return { status: 'ok', data: users }
}

function makeNote(id: string, userId: string): NormalizedNote {
  return {
    id,
    createdAt: '2026-07-01T00:00:00.000Z',
    text: id,
    user: { id: userId, username: userId, host: null, avatarUrl: null },
    visibility: 'public',
    reactions: {},
    reactionEmojis: {},
    files: [],
    _accountId: 'acc1',
  } as unknown as NormalizedNote
}

let store: ReturnType<typeof useSuspensionsStore>

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  api.getUserRaw.mockReset()
  store = useSuspensionsStore()
  // 周期タイマーは止め、再検証は reverifyTick を直接呼んで検証する
  store.stopReverifyCycle()
})

afterEach(() => {
  store.stopReverifyCycle()
  vi.useRealTimers()
})

describe('useSuspensionsStore: probe の 3 値判定 (#828)', () => {
  it('欠落 = 凍結 / isSuspended:true = 凍結 / 返却され false = 解除', async () => {
    api.getUserRaw.mockResolvedValue(
      ok([{ id: 'u2' }, { id: 'u3', isSuspended: true }]),
    )

    store.probe('acc1', ['u1', 'u2', 'u3'])
    await settle()

    expect(store.isSuspended('acc1', 'u1')).toBe(true) // 応答から欠落
    expect(store.isSuspended('acc1', 'u2')).toBe(false)
    expect(store.isSuspended('acc1', 'u3')).toBe(true) // モデレーター経路
  })

  it('chunk の取得に失敗したら無更新にする (fail-open)', async () => {
    store.applyProbeResult('acc1', { suspended: ['u1'] })
    api.getUserRaw.mockRejectedValue(new Error('network'))

    store.probe('acc1', ['u1'])
    await settle()

    // 失敗を「返ってこなかった = 凍結」とも「解除」とも解釈しない
    expect(store.isSuspended('acc1', 'u1')).toBe(true)
  })

  it('50 件ずつに分割して問い合わせる', async () => {
    api.getUserRaw.mockResolvedValue(ok([]))
    const ids = Array.from({ length: 120 }, (_, i) => `u${i}`)

    store.probe('acc1', ids)
    await settle()

    expect(api.getUserRaw).toHaveBeenCalledTimes(3)
    const first = api.getUserRaw.mock.calls[0]?.[1] as { userIds: string[] }
    expect(first.userIds).toHaveLength(50)
  })

  it('同一 id は 15 分間、再問い合わせしない', async () => {
    api.getUserRaw.mockResolvedValue(ok([{ id: 'u1' }]))

    store.probe('acc1', ['u1'])
    await settle()
    expect(api.getUserRaw).toHaveBeenCalledTimes(1)

    store.probe('acc1', ['u1'])
    await settle()
    expect(api.getUserRaw).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 16 * 60_000)
    store.probe('acc1', ['u1'])
    await settle()
    expect(api.getUserRaw).toHaveBeenCalledTimes(2)
  })
})

describe('useSuspensionsStore: 差分 trigger と再検証サイクル (#828)', () => {
  it('集合に差分がなければ購読側を再評価させない', () => {
    store.applyProbeResult('acc1', { suspended: ['u1'] })
    let evals = 0
    const hidden = computed(() => {
      evals++
      return store.isSuspended('acc1', 'u1')
    })
    expect(hidden.value).toBe(true)
    const before = evals

    // 既に凍結済みの u1 を再検知 + 未登録の u9 を解除 = 集合は不変
    store.applyProbeResult('acc1', { suspended: ['u1'], cleared: ['u9'] })

    expect(hidden.value).toBe(true)
    expect(evals).toBe(before)
  })

  it('再検証は TTL 抑制を貫通し、解除を検知する', async () => {
    api.getUserRaw.mockResolvedValue(ok([]))
    store.probe('acc1', ['u1'])
    await settle()
    expect(store.isSuspended('acc1', 'u1')).toBe(true)

    // TTL 内でも再検証サイクルは問い合わせる
    api.getUserRaw.mockResolvedValue(ok([{ id: 'u1' }]))
    store.reverifyTick()
    await settle()

    expect(store.isSuspended('acc1', 'u1')).toBe(false)
  })

  it('検知から 24h を過ぎた entry は再検証済みなら due にしない (aging)', async () => {
    api.getUserRaw.mockResolvedValue(ok([]))
    store.probe('acc1', ['u1'])
    await settle()

    // 25h 後: fresh 期間を抜けている → due
    vi.setSystemTime(Date.now() + 25 * HOUR)
    api.getUserRaw.mockClear()
    store.reverifyTick()
    await settle()
    expect(api.getUserRaw).toHaveBeenCalledTimes(1)

    // 直後は lastVerified が新しいので due にならない
    vi.setSystemTime(Date.now() + HOUR)
    api.getUserRaw.mockClear()
    store.reverifyTick()
    await settle()
    expect(api.getUserRaw).not.toHaveBeenCalled()
  })
})

describe('useSuspensionsStore: probe 供給の 1 点フック (#828)', () => {
  it('useNoteList への新規挿入で当事者が probe される', async () => {
    api.getUserRaw.mockResolvedValue(ok([]))
    const { setNotes } = useNoteList({
      getMyUserId: () => 'me',
      getAdapter: () => null,
      deleteHandler: async () => true,
      closePostForm: () => {
        /* noop */
      },
    })

    setNotes([makeNote('n1', 'author-1'), makeNote('n2', 'author-2')])
    await settle()

    const params = api.getUserRaw.mock.calls[0]?.[1] as { userIds: string[] }
    expect(params.userIds.sort()).toEqual(['author-1', 'author-2'])
  })
})

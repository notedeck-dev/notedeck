// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initAdapterFor } from '@/adapters/factory'
import type { FederationInstance } from '@/adapters/types'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckFederationColumn from './DeckFederationColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

// adapter.api.getFederationInstances だけを持つ adapter。基盤の initAdapter 経由で
// 作られることを initAdapterFor の呼び出しで確かめる
const api = vi.hoisted(() => ({
  getFederationInstances: vi.fn(
    async (_opts: { offset: number }): Promise<unknown[]> => [],
  ),
}))
vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async () => ({
    adapter: {
      api,
      stream: {
        connect: vi.fn(),
        reconnect: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    serverInfo: { iconUrl: null },
  })),
}))

function instance(id: string): FederationInstance {
  return {
    id,
    host: `${id}.example`,
    usersCount: 1,
    notesCount: 1,
    followingCount: 0,
    followersCount: 0,
    isNotResponding: false,
    isSuspended: false,
    isBlocked: false,
    softwareName: 'misskey',
    softwareVersion: '1.0.0',
    name: id,
    description: null,
    iconUrl: null,
    faviconUrl: null,
    themeColor: null,
    firstRetrievedAt: '2026-01-01T00:00:00.000Z',
    latestRequestReceivedAt: null,
    infoUpdatedAt: null,
  } as unknown as FederationInstance
}

beforeEach(() => {
  bindings.reset()
  api.getFederationInstances.mockReset()
  vi.mocked(initAdapterFor).mockClear()
  setupStores()
})

describe('DeckFederationColumn (共通基盤 + usePaginatedList)', () => {
  it('mount で基盤の initAdapter を通して offset 0 の 30 件を取り、スクロールで offset 30 を取る', async () => {
    api.getFederationInstances.mockImplementation(async (opts) =>
      opts.offset === 0
        ? Array.from({ length: 30 }, (_, i) => instance(`i-${i}`))
        : [instance('i-older')],
    )
    const wrapper = await mountColumn(
      DeckFederationColumn,
      makeColumn({ type: 'federation' }),
    )

    expect(vi.mocked(initAdapterFor)).toHaveBeenCalledWith(
      'example.com',
      'acc-1',
      { hasToken: true },
    )
    expect(api.getFederationInstances).toHaveBeenCalledWith({
      limit: 30,
      offset: 0,
      sort: '-pubSub',
      host: null,
      federating: true,
    })

    // scroll は bubble しないので、基盤の scroller に当たるまで div を総当たりする
    // (happy-dom はスクロール寸法が 0 なので 1 回で「末尾に近い」判定になる)
    for (const div of wrapper.findAll('div')) await div.trigger('scroll')
    await flush()

    expect(api.getFederationInstances).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 30 }),
    )
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    api.getFederationInstances.mockRejectedValue(new Error('federation failed'))
    const wrapper = await mountColumn(
      DeckFederationColumn,
      makeColumn({ type: 'federation' }),
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.text()).toContain('federation failed')
  })
})

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeAccount,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckFollowRequestsColumn from './DeckFollowRequestsColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

const stubs = {
  ColumnTabs: true,
  MkAvatar: true,
  MkMfm: { props: ['text'], template: '<span>{{ text }}</span>' },
}

function user(id: string, username: string) {
  return {
    id,
    username,
    host: null,
    name: username,
    avatarUrl: null,
    emojis: {},
  }
}

function request(id: string, followerName: string) {
  return {
    id,
    follower: user(`u-${id}`, followerName),
    followee: user('uid-1', 'alice'),
  }
}

beforeEach(() => {
  bindings.reset()
})

describe('DeckFollowRequestsColumn (共通基盤)', () => {
  it('per-account: mount で受信リクエストを 30 件取り、相手を一覧に出す', async () => {
    setupStores()
    bindings.responses.apiGetFollowRequests = [request('r1', 'bob')]
    const wrapper = await mountColumn(
      DeckFollowRequestsColumn,
      makeColumn({ type: 'followRequests' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetFollowRequests')).toEqual([
      { name: 'apiGetFollowRequests', args: ['acc-1', 30] },
    ])
    expect(wrapper.text()).toContain('bob')
  })

  it('全アカウント: トークンを持つ全アカウントで取り、束ねて出す', async () => {
    setupStores([
      makeAccount({ id: 'acc-1' }),
      makeAccount({ id: 'acc-2', host: 'other.example', userId: 'uid-2' }),
      makeAccount({ id: 'acc-3', hasToken: false }),
    ])
    bindings.responses.apiGetFollowRequests = (accountId: string) => [
      request(`r-${accountId}`, `from-${accountId}`),
    ]
    const wrapper = await mountColumn(
      DeckFollowRequestsColumn,
      makeColumn({ type: 'followRequests', accountId: null }),
      stubs,
    )

    expect(bindings.callsOf('apiGetFollowRequests').map((c) => c.args)).toEqual(
      [
        ['acc-1', 30],
        ['acc-2', 30],
      ],
    )
    expect(wrapper.text()).toContain('from-acc-1')
    expect(wrapper.text()).toContain('from-acc-2')
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    setupStores()
    bindings.responses.apiGetFollowRequests = new Error('requests failed')
    const wrapper = await mountColumn(
      DeckFollowRequestsColumn,
      makeColumn({ type: 'followRequests' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text()).toContain('requests failed')
  })
})

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckExploreColumn from './DeckExploreColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
// ノートタブは useNoteColumn (別テスト済み)。adapter は featured を空で返す
vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async () => ({
    adapter: {
      api: { getFeaturedNotes: vi.fn(async () => []) },
      stream: {
        connect: vi.fn(),
        reconnect: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        subNote: vi.fn(),
        unsubNote: vi.fn(),
      },
    },
    serverInfo: { iconUrl: null },
  })),
}))
// dedup Worker は happy-dom に無いので常に失敗させ、メインスレッド fallback を通す
vi.mock('@/utils/workerClient', () => ({
  createWorkerClient: () => ({
    post: () => Promise.reject(new Error('no worker in test')),
  }),
}))

const ColumnTabsStub = {
  props: ['tabs', 'modelValue'],
  emits: ['update:modelValue'],
  template:
    '<div><button v-for="t in tabs" :key="t.value" :data-tab="t.value" @click="$emit(\'update:modelValue\', t.value)" /></div>',
}
const stubs = {
  ColumnTabs: ColumnTabsStub,
  NoteScroller: true,
  MkNote: true,
  ReadMarkerDivider: true,
  MkPostForm: true,
  MkMfm: { props: ['text'], template: '<span>{{ text }}</span>' },
  MkUserListItem: {
    props: ['user'],
    template: '<div data-user>{{ user.username }}</div>',
  },
}

function user(id: string, username: string) {
  return {
    id,
    username,
    host: null,
    name: null,
    avatarUrl: null,
    followersCount: 0,
    description: null,
  }
}

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckExploreColumn (ユーザー / ロールのタブは usePaginatedList)', () => {
  it('ユーザータブに切り替えたら一度だけ検索し、戻って再び開いても取り直さない', async () => {
    bindings.responses.apiSearchUsers = [user('u1', 'bob')]
    bindings.responses.apiGetUserRelations = []
    const wrapper = await mountColumn(
      DeckExploreColumn,
      makeColumn({ type: 'explore' }),
      stubs,
    )
    expect(bindings.callsOf('apiSearchUsers')).toHaveLength(0)

    await wrapper.get('[data-tab="users"]').trigger('click')
    await flush()

    expect(bindings.callsOf('apiSearchUsers').map((c) => c.args)).toEqual([
      ['acc-1', null, 'combined', '+follower', 'alive', 30, null],
    ])
    expect(wrapper.text()).toContain('bob')

    await wrapper.get('[data-tab="notes"]').trigger('click')
    await wrapper.get('[data-tab="users"]').trigger('click')
    await flush()
    expect(bindings.callsOf('apiSearchUsers')).toHaveLength(1)
  })

  it('ロールタブは manual のロールだけを displayOrder 降順で出し、失敗はタブの error に出る', async () => {
    bindings.responses.apiGetRoles = [
      {
        id: 'r1',
        name: 'Low',
        target: 'manual',
        displayOrder: 1,
        usersCount: 0,
        color: null,
        iconUrl: null,
        description: null,
      },
      {
        id: 'r2',
        name: 'Auto',
        target: 'conditional',
        displayOrder: 9,
        usersCount: 0,
        color: null,
        iconUrl: null,
        description: null,
      },
      {
        id: 'r3',
        name: 'High',
        target: 'manual',
        displayOrder: 5,
        usersCount: 0,
        color: null,
        iconUrl: null,
        description: null,
      },
    ]
    const wrapper = await mountColumn(
      DeckExploreColumn,
      makeColumn({ type: 'explore' }),
      stubs,
    )

    await wrapper.get('[data-tab="roles"]').trigger('click')
    await flush()

    expect(bindings.callsOf('apiGetRoles').map((c) => c.args)).toEqual([
      ['acc-1'],
    ])
    const text = wrapper.text()
    expect(text.indexOf('High')).toBeLessThan(text.indexOf('Low'))
    expect(text).not.toContain('Auto')

    bindings.responses.apiSearchUsers = new Error('users failed')
    await wrapper.get('[data-tab="users"]').trigger('click')
    await flush()
    const empty = wrapper.get('[data-empty-state]')
    expect(empty.text()).toContain('users failed')
  })
})

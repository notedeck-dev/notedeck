// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckPageColumn from './DeckPageColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

/** ColumnTabs の差し替え: ボタンでタブ切替を emit する */
const ColumnTabsStub = {
  props: ['tabs', 'modelValue'],
  emits: ['update:modelValue'],
  template:
    '<div><button v-for="t in tabs" :key="t.value" :data-tab="t.value" @click="$emit(\'update:modelValue\', t.value)" /></div>',
}
const stubs = {
  ColumnTabs: ColumnTabsStub,
  MkMfm: { props: ['text'], template: '<span>{{ text }}</span>' },
}

function page(id: string, title: string) {
  return {
    id,
    title,
    name: id,
    summary: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    userId: 'uid-1',
    user: {
      id: 'uid-1',
      username: 'alice',
      host: null,
      name: null,
      avatarUrl: null,
    },
    likedCount: 0,
    eyeCatchingImage: null,
  }
}

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckPageColumn (共通基盤)', () => {
  it('mount で featured を 30 件取り、タブ切替で別のエンドポイントを取る', async () => {
    bindings.responses.apiGetPages = (_a: string, endpoint: string) => [
      page(`p-${endpoint}`, `title of ${endpoint}`),
    ]
    const wrapper = await mountColumn(
      DeckPageColumn,
      makeColumn({ type: 'page' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetPages')).toEqual([
      { name: 'apiGetPages', args: ['acc-1', 'pages/featured', 30] },
    ])
    expect(wrapper.text()).toContain('title of pages/featured')

    await wrapper.get('[data-tab="my"]').trigger('click')
    await flush()

    expect(bindings.callsOf('apiGetPages').at(-1)?.args).toEqual([
      'acc-1',
      'i/pages',
      30,
    ])
    expect(wrapper.text()).toContain('title of i/pages')
    expect(wrapper.text()).not.toContain('title of pages/featured')
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    bindings.responses.apiGetPages = new Error('pages failed')
    const wrapper = await mountColumn(
      DeckPageColumn,
      makeColumn({ type: 'page' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text()).toContain('pages failed')
  })
})

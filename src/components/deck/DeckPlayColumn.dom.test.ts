// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckPlayColumn from './DeckPlayColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

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

function flash(id: string, title: string) {
  return {
    id,
    title,
    summary: `${title} summary`,
    userId: 'uid-1',
    user: { username: 'alice', host: null, name: null, avatarUrl: null },
    likedCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckPlayColumn (共通基盤)', () => {
  it('mount で featured を 30 件取り、likes タブは { id, flash } の包みを剥がす', async () => {
    bindings.responses.apiGetFlashes = (_a: string, endpoint: string) =>
      endpoint === 'flash/my-likes'
        ? [{ id: 'like-1', flash: flash('f-liked', 'Liked Play') }]
        : [flash(`f-${endpoint}`, `Play of ${endpoint}`)]
    const wrapper = await mountColumn(
      DeckPlayColumn,
      makeColumn({ type: 'play' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetFlashes')).toEqual([
      { name: 'apiGetFlashes', args: ['acc-1', 'flash/featured', 30] },
    ])
    expect(wrapper.text()).toContain('Play of flash/featured')

    await wrapper.get('[data-tab="likes"]').trigger('click')
    await flush()

    expect(bindings.callsOf('apiGetFlashes').at(-1)?.args).toEqual([
      'acc-1',
      'flash/my-likes',
      30,
    ])
    expect(wrapper.text()).toContain('Liked Play')
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    bindings.responses.apiGetFlashes = new Error('flash failed')
    const wrapper = await mountColumn(
      DeckPlayColumn,
      makeColumn({ type: 'play' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text()).toContain('flash failed')
  })
})

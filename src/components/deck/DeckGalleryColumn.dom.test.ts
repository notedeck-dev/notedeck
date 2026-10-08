// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckGalleryColumn from './DeckGalleryColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

const stubs = {
  GalleryItemMenu: true,
  MkMfm: { props: ['text'], template: '<span>{{ text }}</span>' },
}

function post(id: string) {
  return {
    id,
    title: `post ${id}`,
    description: null,
    userId: 'uid-1',
    user: {
      id: 'uid-1',
      username: 'alice',
      host: null,
      name: null,
      avatarUrl: null,
    },
    files: [],
    isSensitive: false,
    likedCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckGalleryColumn (共通基盤 + usePaginatedList)', () => {
  it('mount で 20 件取り、末尾までスクロールしたら末尾の id を untilId に次を取る', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => post(`g-${i}`))
    bindings.responses.apiGetGalleryPosts = (
      _a: string,
      _limit: number,
      untilId: string | null,
    ) => (untilId ? [post('g-older')] : firstPage)
    const wrapper = await mountColumn(
      DeckGalleryColumn,
      makeColumn({ type: 'gallery' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetGalleryPosts')).toEqual([
      { name: 'apiGetGalleryPosts', args: ['acc-1', 20, null] },
    ])
    expect(wrapper.text()).toContain('post g-19')

    // scroll は bubble しないので、基盤の scroller に当たるまで div を総当たりする
    // (happy-dom はスクロール寸法が 0 なので 1 回で「末尾に近い」判定になる)
    for (const div of wrapper.findAll('div')) await div.trigger('scroll')
    await flush()

    expect(bindings.callsOf('apiGetGalleryPosts').at(-1)?.args).toEqual([
      'acc-1',
      20,
      'g-19',
    ])
    expect(wrapper.text()).toContain('post g-older')
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    bindings.responses.apiGetGalleryPosts = new Error('gallery failed')
    const wrapper = await mountColumn(
      DeckGalleryColumn,
      makeColumn({ type: 'gallery' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text()).toContain('gallery failed')
  })
})

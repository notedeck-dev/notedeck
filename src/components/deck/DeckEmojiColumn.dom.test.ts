// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEmojisStore } from '@/stores/emojis'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckEmojiColumn from './DeckEmojiColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

const stubs = { PopupMenu: true }

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckEmojiColumn (共通基盤)', () => {
  it('mount でサーバー絵文字を取り (未取得のホストだけ)、辞書 store に入れる', async () => {
    bindings.responses.apiGetServerEmojis = [
      {
        name: 'blobcat',
        url: 'https://example.com/blobcat.png',
        category: 'cats',
        aliases: [],
      },
    ]
    await mountColumn(DeckEmojiColumn, makeColumn({ type: 'emoji' }), stubs)

    expect(bindings.callsOf('apiGetServerEmojis')).toEqual([
      { name: 'apiGetServerEmojis', args: ['acc-1', false] },
    ])
    expect(useEmojisStore().has('example.com')).toBe(true)
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    bindings.responses.apiGetServerEmojis = new Error('emoji failed')
    const wrapper = await mountColumn(
      DeckEmojiColumn,
      makeColumn({ type: 'emoji' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text()).toContain('emoji failed')
  })
})

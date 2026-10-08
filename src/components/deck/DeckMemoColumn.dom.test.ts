// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { bindings, makeColumn, mountColumn, setupStores } from './columnTestKit'
import DeckMemoColumn from './DeckMemoColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})
// 投稿フォーム本体は対象外 (非同期 import なので stub 名では差し替わらない)
vi.mock('@/components/common/MkPostForm.vue', () => ({
  // defineAsyncComponent が default を取り出せるよう ES module の印を付ける
  __esModule: true,
  default: { name: 'MkPostForm', template: '<div data-post-form />' },
}))

const stubs = { MemoCard: true, PopupMenu: true }

beforeEach(() => {
  bindings.reset()
  vi.mocked(useColumnSetup).mockClear()
  setupStores()
})

describe('DeckMemoColumn (共通基盤)', () => {
  it('アカウントなしのカラムとして共通基盤を setup し、メモが無ければ空表示', async () => {
    const column = makeColumn({ type: 'memo', accountId: null })
    const wrapper = await mountColumn(DeckMemoColumn, column, stubs)

    expect(vi.mocked(useColumnSetup).mock.calls[0]?.[0]()).toMatchObject({
      id: 'col-1',
      type: 'memo',
    })
    expect(bindings.calls).toHaveLength(0)
    expect(wrapper.find('[data-empty-state]').exists()).toBe(true)
  })
})

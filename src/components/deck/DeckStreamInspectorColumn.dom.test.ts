// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { bindings, makeColumn, mountColumn, setupStores } from './columnTestKit'
import DeckStreamInspectorColumn from './DeckStreamInspectorColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})

const stubs = { ColumnBadges: true }

beforeEach(() => {
  bindings.reset()
  vi.mocked(useColumnSetup).mockClear()
  setupStores()
})

describe('DeckStreamInspectorColumn (共通基盤)', () => {
  it('アカウント付きなら基盤の account とサーバーアイコン (無ければ favicon) をヘッダーに出す', async () => {
    const column = makeColumn({ type: 'streamInspector' })
    const wrapper = await mountColumn(DeckStreamInspectorColumn, column, stubs)

    expect(vi.mocked(useColumnSetup).mock.calls[0]?.[0]()).toMatchObject({
      id: 'col-1',
      type: 'streamInspector',
    })
    const favicon = wrapper
      .findAll('img')
      .find((img) => img.attributes('src')?.includes('favicon.ico'))
    expect(favicon?.attributes('title')).toBe('example.com')
    expect(wrapper.find('[data-empty-state]').exists()).toBe(true)
    wrapper.unmount()
  })
})

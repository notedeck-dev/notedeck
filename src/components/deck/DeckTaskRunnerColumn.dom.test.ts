// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { bindings, makeColumn, mountColumn, setupStores } from './columnTestKit'
import DeckTaskRunnerColumn from './DeckTaskRunnerColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})

const stubs = { AppTime: true, RawJsonView: true }

beforeEach(() => {
  bindings.reset()
  vi.mocked(useColumnSetup).mockClear()
  setupStores()
})

describe('DeckTaskRunnerColumn (共通基盤)', () => {
  it('アカウントなしのカラムとして共通基盤を setup し、タスク定義が無ければ空表示', async () => {
    const column = makeColumn({ type: 'taskRunner', accountId: null })
    const wrapper = await mountColumn(DeckTaskRunnerColumn, column, stubs)

    expect(vi.mocked(useColumnSetup).mock.calls[0]?.[0]()).toMatchObject({
      id: 'col-1',
      type: 'taskRunner',
    })
    expect(wrapper.find('[data-empty-state]').exists()).toBe(true)
    wrapper.unmount()
  })
})

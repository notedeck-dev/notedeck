// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnSetup } from '@/composables/useColumnSetup'
import {
  bindings,
  DeckColumnStub,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckAiColumn from './DeckAiColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})

// AI カラムは DeckColumn を別名 (DeckColumnComponent) で import している
const stubs = { AppTime: true, DeckColumnComponent: DeckColumnStub }

beforeEach(() => {
  bindings.reset()
  vi.mocked(useColumnSetup).mockClear()
  setupStores()
})

describe('DeckAiColumn (共通基盤)', () => {
  it('カラムのアカウント解決を共通基盤で行う (テーマ変数は従来どおり渡さない)', async () => {
    const column = makeColumn({ type: 'ai' })
    const wrapper = await mountColumn(DeckAiColumn, column, stubs)

    expect(vi.mocked(useColumnSetup).mock.calls[0]?.[0]()).toMatchObject({
      id: 'col-1',
      type: 'ai',
    })
    const deck = wrapper.get('[data-deck-column]')
    expect(deck.attributes('data-title')?.length).toBeGreaterThan(0)
    wrapper.unmount()
  })
})

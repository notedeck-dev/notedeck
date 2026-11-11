// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useUiStateStore } from '@/stores/uiState'
import { bindings, makeColumn, mountColumn, setupStores } from './columnTestKit'
import DeckAiScriptColumn from './DeckAiScriptColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})

// エディタ (CodeMirror) と UI レンダラは対象外
const stubs = {
  AiScriptEditor: true,
  AiScriptUiRenderer: true,
  AiScriptDialog: true,
}

beforeEach(() => {
  bindings.reset()
  vi.mocked(useColumnSetup).mockClear()
  setupStores()
})

describe('DeckAiScriptColumn (共通基盤)', () => {
  it('共通基盤をカラムで setup し、mount では何も取りに行かない', async () => {
    const column = makeColumn({ type: 'aiscript' })
    const wrapper = await mountColumn(DeckAiScriptColumn, column, stubs)

    expect(vi.mocked(useColumnSetup).mock.calls[0]?.[0]()).toMatchObject({
      id: 'col-1',
      type: 'aiscript',
    })
    expect(bindings.calls).toHaveLength(0)
    expect(wrapper.find('[data-deck-column]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('サイドバーのカラムは、閉じるときにコードを下書きとして残す', async () => {
    const column = makeColumn({ type: 'aiscript', sidebar: true })
    const wrapper = await mountColumn(DeckAiScriptColumn, column, stubs)
    // 500ms の保存を待たずに閉じても、最後の入力まで残る
    wrapper
      .findComponent({ name: 'AiScriptEditor' })
      .vm.$emit('update:modelValue', '<: "edited"')
    await wrapper.vm.$nextTick()
    wrapper.unmount()
    expect(useUiStateStore().get('deck.sidebarDrafts')?.aiscriptCode).toBe(
      '<: "edited"',
    )
  })
})

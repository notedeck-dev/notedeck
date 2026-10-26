// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckMfmEditorColumn from './DeckMfmEditorColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})

// プレビュー (MkMfm / 関数一覧 / CodeMirror) は対象外
const stubs = {
  MkMfm: true,
  MfmFunctionTable: true,
  CodeEditor: true,
}

beforeEach(() => {
  bindings.reset()
  vi.mocked(useColumnSetup).mockClear()
  setupStores()
})

describe('DeckMfmEditorColumn', () => {
  it('共通基盤をカラムで setup し、mount では何も取りに行かない', async () => {
    const column = makeColumn({ type: 'mfmEditor', accountId: null })
    const wrapper = await mountColumn(DeckMfmEditorColumn, column, stubs)
    expect(vi.mocked(useColumnSetup).mock.calls[0]?.[0]()).toMatchObject({
      id: 'col-1',
      type: 'mfmEditor',
    })
    expect(bindings.calls).toHaveLength(0)
    expect(wrapper.find('[data-deck-column]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('本文はカラム設定 mfmText から復元し、編集はまとめてカラム設定に書く', async () => {
    vi.useFakeTimers()
    try {
      const column = makeColumn({
        type: 'mfmEditor',
        accountId: null,
        mfmText: '$[spin a]',
      })
      const deckStore = useDeckStore()
      deckStore.columns.push(column)
      const wrapper = await mountColumn(DeckMfmEditorColumn, column, stubs)
      const area = wrapper.find('textarea')
      expect((area.element as HTMLTextAreaElement).value).toBe('$[spin a]')

      await area.setValue('$[tada b]')
      await flush()
      expect(deckStore.getColumn('col-1')?.mfmText).toBe('$[spin a]')
      vi.advanceTimersByTime(600)
      expect(deckStore.getColumn('col-1')?.mfmText).toBe('$[tada b]')
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('「投稿フォームへ」は本文で投稿フォームを開く要求を出す', async () => {
    const column = makeColumn({
      type: 'mfmEditor',
      accountId: null,
      mfmText: '**hi**',
    })
    const wrapper = await mountColumn(DeckMfmEditorColumn, column, stubs)
    await wrapper.find('button[title]').trigger('click')
    expect(useUiStore().composeRequest?.text).toBe('**hi**')
    wrapper.unmount()
  })
})

// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDeckStore } from '@/stores/deck'
import { useUiStateStore } from '@/stores/uiState'

/**
 * サイドバーのカラムは閉じると消える。スクラッチパッドと MFM エディタの本文は
 * カラムの持ち物なので、下書きとして別に残したものを開き直すときに戻す。
 */
describe('サイドバーのカラムの下書き', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  const sidebar = () => useDeckStore().columns.find((c) => c.sidebar)

  it('閉じて開き直したスクラッチパッドに、残した下書きが戻る', () => {
    const deck = useDeckStore()
    deck.load()
    deck.toggleSidebarColumn('aiscript', null)
    useUiStateStore().set('deck.sidebarDrafts', { aiscriptCode: '<: 1' })
    deck.toggleSidebarColumn('aiscript', null)
    expect(sidebar()).toBeUndefined()

    deck.toggleSidebarColumn('aiscript', null)
    expect(sidebar()?.aiscriptCode).toBe('<: 1')
  })

  it('別の種別に切り替えてから戻しても、下書きが戻る', () => {
    const deck = useDeckStore()
    deck.load()
    useUiStateStore().set('deck.sidebarDrafts', { mfmText: '**a**' })
    deck.toggleSidebarColumn('favorites', null)
    expect(sidebar()?.mfmText).toBeUndefined()
    deck.toggleSidebarColumn('mfmEditor', null)
    expect(sidebar()?.mfmText).toBe('**a**')
  })
})

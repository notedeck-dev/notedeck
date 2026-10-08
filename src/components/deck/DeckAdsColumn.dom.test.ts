// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnSetup } from '@/composables/useColumnSetup'
import {
  bindings,
  makeAccount,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckAdsColumn from './DeckAdsColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})

const stubs = { MkAd: { props: ['ad'], template: '<div data-ad />' } }

beforeEach(() => {
  bindings.reset()
  vi.mocked(useColumnSetup).mockClear()
  setupStores()
})

describe('DeckAdsColumn (共通基盤)', () => {
  it('mount で meta (広告一覧の元) を取り、共通基盤をカラムで setup する', async () => {
    bindings.responses.apiGetMetaDetail = {
      ads: [
        {
          id: 'ad-1',
          url: 'https://example.com',
          place: 'horizontal',
          ratio: 1,
          imageUrl: 'https://example.com/ad.png',
          dayOfWeek: 0,
        },
      ],
      notesPerOneAd: 0,
    }
    const column = makeColumn({ type: 'ads' })
    const wrapper = await mountColumn(DeckAdsColumn, column, stubs)

    expect(vi.mocked(useColumnSetup)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(useColumnSetup).mock.calls[0]?.[0]()).toMatchObject({
      id: column.id,
      type: 'ads',
    })
    expect(bindings.callsOf('apiGetMetaDetail').map((c) => c.args[0])).toEqual([
      'acc-1',
    ])
    const deck = wrapper.get('[data-deck-column]')
    expect(deck.attributes('data-require-account')).toBe('1')
    expect(deck.attributes('data-pull-refresh')).toBe('1')
  })

  it('広告が無ければ空表示', async () => {
    // useAds はアカウント単位で広告をキャッシュするので、前のテストと別アカウントにする
    setupStores([makeAccount({ id: 'acc-2' })])
    bindings.responses.apiGetMetaDetail = { ads: [], notesPerOneAd: 0 }
    const wrapper = await mountColumn(
      DeckAdsColumn,
      makeColumn({ type: 'ads', accountId: 'acc-2' }),
      stubs,
    )

    expect(wrapper.find('[data-empty-state]').exists()).toBe(true)
  })
})

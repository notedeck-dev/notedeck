// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initAdapterFor } from '@/adapters/factory'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckChartsColumn from './DeckChartsColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
// canvas の無い happy-dom で chart.js を動かさない。描画は対象外
vi.mock('chart.js', () => ({
  Chart: class {
    destroy() {
      // canvas が無いので何もしない
    }
    resize() {
      // 同上
    }
    update() {
      // 同上
    }
  },
}))
vi.mock('@/utils/initChart', () => ({ applyAlpha: (c: string) => c }))

// 各チャートの応答 (列はどれも 1 点)。描画は mock した Chart に渡るだけ
const api = vi.hoisted(() => {
  const s = () => [1]
  const section = { total: s(), inc: s(), dec: s() }
  const diffs = { normal: s(), reply: s(), renote: s(), withFile: s() }
  const drive = { incCount: s(), incSize: s(), decCount: s(), decSize: s() }
  const chart = <T>(data: T) => vi.fn(async (): Promise<T> => data)
  return {
    getActiveUsersChart: chart({
      readWrite: s(),
      read: s(),
      write: s(),
      registeredWithinWeek: s(),
      registeredWithinMonth: s(),
      registeredWithinYear: s(),
      registeredOutsideWeek: s(),
      registeredOutsideMonth: s(),
      registeredOutsideYear: s(),
    }),
    getFederationChart: chart({
      deliveredInstances: s(),
      inboxInstances: s(),
      stalled: s(),
      sub: s(),
      pub: s(),
      pubsub: s(),
      subActive: s(),
      pubActive: s(),
    }),
    getApRequestChart: chart({
      deliverSucceeded: s(),
      deliverFailed: s(),
      inboxReceived: s(),
    }),
    getServerNotesChart: chart({
      local: { ...section, diffs },
      remote: { ...section, diffs },
    }),
    getServerUsersChart: chart({ local: section, remote: section }),
    getServerDriveChart: chart({ local: drive, remote: drive }),
  }
})
vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async () => ({
    adapter: {
      api,
      stream: {
        connect: vi.fn(),
        reconnect: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    serverInfo: { iconUrl: null },
  })),
}))

const stubs = { ColumnTabs: true, RawJsonView: true }

beforeEach(() => {
  bindings.reset()
  vi.mocked(initAdapterFor).mockClear()
  for (const fn of Object.values(api)) fn.mockClear()
  setupStores()
})

describe('DeckChartsColumn (共通基盤)', () => {
  it('mount で基盤の initAdapter を通し、6 種のチャートを hour × 48 点で取る', async () => {
    await mountColumn(DeckChartsColumn, makeColumn({ type: 'charts' }), stubs)

    expect(vi.mocked(initAdapterFor)).toHaveBeenCalledWith(
      'example.com',
      'acc-1',
      { hasToken: true },
    )
    for (const fn of Object.values(api)) {
      expect(fn).toHaveBeenCalledWith('hour', 48)
    }
  })

  it('取得に失敗したら基盤の error から理由を出す (AUTH 以外は「無効」の文言)', async () => {
    api.getActiveUsersChart.mockRejectedValueOnce(new Error('charts failed'))
    // 失敗側のテストなので他の応答はそのまま
    const wrapper = await mountColumn(
      DeckChartsColumn,
      makeColumn({ type: 'charts' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text().length).toBeGreaterThan(0)
    expect(wrapper.find('[data-loading-spinner]').exists()).toBe(false)
  })
})

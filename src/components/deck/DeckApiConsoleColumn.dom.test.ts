// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckApiConsoleColumn from './DeckApiConsoleColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

beforeEach(() => {
  bindings.reset()
  setupStores()
})

async function mountAndRun(endpoint: string, params = '{}') {
  const wrapper = await mountColumn(
    DeckApiConsoleColumn,
    makeColumn({ type: 'apiConsole' }),
  )
  await wrapper.get('input').setValue(endpoint)
  await wrapper.get('textarea').setValue(params)
  await wrapper.get('button').trigger('click')
  await flush()
  return wrapper
}

describe('DeckApiConsoleColumn (共通基盤)', () => {
  it('mount では何も取りに行かず、送信でカラムのアカウントの apiRequest を呼ぶ', async () => {
    bindings.responses.apiRequest = { ok: true }
    const wrapper = await mountAndRun('meta', '{"detail": false}')

    expect(bindings.calls.map((c) => c.name)).toEqual(['apiRequest'])
    expect(bindings.callsOf('apiRequest')[0]?.args).toEqual([
      'acc-1',
      'meta',
      { detail: false },
    ])
    expect(wrapper.get('pre').text()).toContain('"ok": true')
  })

  it('失敗は基盤の error を文言にして出す (パラメータの JSON 不正も同じ経路)', async () => {
    bindings.responses.apiRequest = new Error('request failed')
    let wrapper = await mountAndRun('meta')
    expect(wrapper.text()).toContain('request failed')

    bindings.reset()
    wrapper = await mountAndRun('meta', '{not json')
    expect(bindings.callsOf('apiRequest')).toHaveLength(0)
    expect(wrapper.find('pre').exists()).toBe(false)
  })
})

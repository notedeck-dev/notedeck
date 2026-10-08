// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckApiDocsColumn from './DeckApiDocsColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
// Scalar の本体は happy-dom で動かさない。spec を受け取ることだけ見る
vi.mock('@scalar/api-reference', () => ({
  ApiReference: {
    props: ['configuration'],
    template:
      '<div data-api-reference :data-has-spec="configuration.content ? 1 : 0" />',
  },
}))

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckApiDocsColumn (共通基盤)', () => {
  it('mount でアプリ自身の OpenAPI spec を取り、Scalar に渡す', async () => {
    bindings.responses.getOpenapiSpec = { openapi: '3.1.0', paths: {} }
    const wrapper = await mountColumn(
      DeckApiDocsColumn,
      makeColumn({ type: 'apiDocs', accountId: null }),
    )

    expect(bindings.calls.map((c) => c.name)).toEqual(['getOpenapiSpec'])
    expect(
      wrapper.get('[data-api-reference]').attributes('data-has-spec'),
    ).toBe('1')
  })

  it('取得に失敗したら基盤の error の文言を出す', async () => {
    bindings.responses.getOpenapiSpec = new Error('spec failed')
    const wrapper = await mountColumn(
      DeckApiDocsColumn,
      makeColumn({ type: 'apiDocs', accountId: null }),
    )
    await flush()

    expect(wrapper.text()).toContain('spec failed')
    expect(wrapper.find('[data-loading-spinner]').exists()).toBe(false)
  })
})

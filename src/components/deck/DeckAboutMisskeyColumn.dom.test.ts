// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckAboutMisskeyColumn from './DeckAboutMisskeyColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

const stubs = { MkPostForm: true }

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckAboutMisskeyColumn (共通基盤)', () => {
  it('mount でカラムのアカウントの meta を取り、バージョンを出す', async () => {
    bindings.responses.apiGetMetaDetail = {
      version: '2026.1.0',
      repositoryUrl: 'https://github.com/misskey-dev/misskey',
      name: 'Example',
    }
    const wrapper = await mountColumn(
      DeckAboutMisskeyColumn,
      makeColumn({ type: 'aboutMisskey' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetMetaDetail')).toEqual([
      { name: 'apiGetMetaDetail', args: ['acc-1'] },
    ])
    expect(wrapper.text()).toContain('2026.1.0')
    expect(
      wrapper.get('[data-deck-column]').attributes('data-pull-refresh'),
    ).toBe('1')
  })

  it('取得に失敗したら基盤の error の文言を出す', async () => {
    bindings.responses.apiGetMetaDetail = new Error('meta failed')
    const wrapper = await mountColumn(
      DeckAboutMisskeyColumn,
      makeColumn({ type: 'aboutMisskey' }),
      stubs,
    )
    await flush()

    expect(wrapper.text()).toContain('meta failed')
  })
})

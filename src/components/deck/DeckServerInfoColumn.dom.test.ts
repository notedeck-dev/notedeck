// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckServerInfoColumn from './DeckServerInfoColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

const stubs = { EditorTabs: true, I18n: true, RawJsonView: true }

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckServerInfoColumn (共通基盤)', () => {
  it('mount で meta と stats をカラムのアカウントで取り、サーバー名を出す', async () => {
    bindings.responses.apiGetMetaDetail = {
      uri: 'https://example.com',
      name: 'Example Server',
      description: null,
      version: '2026.1.0',
      maintainerName: null,
      maintainerEmail: null,
      inquiryUrl: null,
      iconUrl: null,
      bannerUrl: null,
      tosUrl: null,
      repositoryUrl: null,
      impressumUrl: null,
      privacyPolicyUrl: null,
      feedbackUrl: null,
      langs: [],
      serverRules: [],
    }
    bindings.responses.apiGetServerStats = {
      notesCount: 1,
      originalNotesCount: 1,
      usersCount: 1,
      originalUsersCount: 1,
      instances: 1,
    }
    const wrapper = await mountColumn(
      DeckServerInfoColumn,
      makeColumn({ type: 'serverInfo' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetMetaDetail')).toEqual([
      { name: 'apiGetMetaDetail', args: ['acc-1'] },
    ])
    expect(bindings.callsOf('apiGetServerStats')).toEqual([
      { name: 'apiGetServerStats', args: ['acc-1'] },
    ])
    expect(wrapper.text()).toContain('Example Server')
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    bindings.responses.apiGetMetaDetail = new Error('meta failed')
    const wrapper = await mountColumn(
      DeckServerInfoColumn,
      makeColumn({ type: 'serverInfo' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text()).toContain('meta failed')
  })
})

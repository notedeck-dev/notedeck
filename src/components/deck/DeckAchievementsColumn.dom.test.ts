// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeAccount,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckAchievementsColumn from './DeckAchievementsColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

const stubs = {
  ColumnTabs: true,
  MkAchievementsGrid: {
    props: ['achievements'],
    template: '<div data-grid :data-count="achievements.length" />',
  },
}

beforeEach(() => {
  bindings.reset()
})

describe('DeckAchievementsColumn (共通基盤)', () => {
  it('ログイン済みなら mount でサーバー実績をカラムのアカウントとそのユーザーで取る', async () => {
    setupStores()
    bindings.responses.apiGetUserAchievements = [
      { name: 'notes1', unlockedAt: 1 },
      { name: 'notes10', unlockedAt: 2 },
    ]
    const wrapper = await mountColumn(
      DeckAchievementsColumn,
      makeColumn({ type: 'achievements' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetUserAchievements')).toEqual([
      { name: 'apiGetUserAchievements', args: ['acc-1', 'uid-1'] },
    ])
    expect(wrapper.get('[data-grid]').attributes('data-count')).toBe('2')
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    setupStores()
    bindings.responses.apiGetUserAchievements = new Error('achievements failed')
    const wrapper = await mountColumn(
      DeckAchievementsColumn,
      makeColumn({ type: 'achievements' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text()).toContain('achievements failed')
  })

  it('ログアウト中のアカウントでは NoteDeck 実績を既定にし、サーバーは叩く (失敗は隠す)', async () => {
    setupStores([makeAccount({ hasToken: false })])
    bindings.responses.apiGetUserAchievements = new Error('CREDENTIAL_REQUIRED')
    const wrapper = await mountColumn(
      DeckAchievementsColumn,
      makeColumn({ type: 'achievements' }),
      stubs,
    )
    await flush()

    // ログアウト中はエラー表示を出さない (!isLoggedOut ガード)
    expect(wrapper.find('[data-empty-state][data-is-error="1"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-grid]').exists()).toBe(true)
  })
})

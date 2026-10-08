// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindings,
  flush,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckAnnouncementsColumn from './DeckAnnouncementsColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)

const stubs = {
  MkMfm: { props: ['text'], template: '<span>{{ text }}</span>' },
  AppTime: true,
}

function announcement(id: string, title: string) {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    title,
    text: `${title} body`,
    imageUrl: null,
    icon: 'info',
    display: 'normal',
    needConfirmationToRead: false,
    silence: false,
    forYou: false,
    isRead: false,
  }
}

beforeEach(() => {
  bindings.reset()
  setupStores()
})

describe('DeckAnnouncementsColumn (共通基盤)', () => {
  it('mount でカラムのアカウントのお知らせを 20 件 (withUnreads) 取り、一覧に出す', async () => {
    bindings.responses.apiGetAnnouncements = [
      announcement('a1', 'Hello'),
      announcement('a2', 'World'),
    ]
    const wrapper = await mountColumn(
      DeckAnnouncementsColumn,
      makeColumn({ type: 'announcements' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetAnnouncements')).toEqual([
      { name: 'apiGetAnnouncements', args: ['acc-1', 20, true] },
    ])
    expect(wrapper.text()).toContain('Hello')
    expect(wrapper.text()).toContain('World')
    const deck = wrapper.get('[data-deck-column]')
    expect(deck.attributes('data-pull-refresh')).toBe('1')
    expect(deck.attributes('data-require-account')).toBe('1')
  })

  it('取得に失敗したら基盤の error が ColumnEmptyState に出る', async () => {
    bindings.responses.apiGetAnnouncements = new Error('server down')
    const wrapper = await mountColumn(
      DeckAnnouncementsColumn,
      makeColumn({ type: 'announcements' }),
      stubs,
    )
    await flush()

    const empty = wrapper.get('[data-empty-state]')
    expect(empty.attributes('data-is-error')).toBe('1')
    expect(empty.text()).toContain('server down')
  })

  it('アカウントが解決できなければ取りに行かない', async () => {
    await mountColumn(
      DeckAnnouncementsColumn,
      makeColumn({ type: 'announcements', accountId: 'missing' }),
      stubs,
    )

    expect(bindings.callsOf('apiGetAnnouncements')).toHaveLength(0)
  })
})

// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAccount, setupStores } from '@/components/deck/columnTestKit'
import MkNote from './MkNote.vue'

vi.mock('@/bindings', async () =>
  (await import('@/components/deck/columnTestKit.bindings')).bindingsMock(),
)

/**
 * 仮想スクローラの外 (ノート詳細 / 引用 / プロフィール) の MkNote で MFM の
 * アニメが止まっていた (#1083)。nearViewport は boolean prop なので、渡さないと
 * Vue の Boolean casting で undefined でなく false になり、全部「画面外」扱いで
 * --nd-mfm-play-state: paused が付いていた。
 */

function makeNote() {
  const account = makeAccount()
  return {
    id: 'n1',
    createdAt: '2026-10-26T00:00:00.000Z',
    text: '$[spin a]',
    cw: null,
    visibility: 'public',
    localOnly: false,
    renoteCount: 0,
    repliesCount: 0,
    reactions: {},
    reactionEmojis: {},
    emojis: {},
    files: [],
    fileIds: [],
    tags: [],
    user: {
      id: 'u1',
      username: 'alice',
      name: 'Alice',
      host: null,
      avatarUrl: null,
      avatarDecorations: [],
      emojis: {},
      isBot: false,
      isCat: false,
    },
    userId: 'u1',
    _accountId: account.id,
    _serverHost: account.host,
  } as unknown as InstanceType<typeof MkNote>['$props']['note']
}

function mountNote(props: Record<string, unknown> = {}) {
  return mount(MkNote, {
    props: { note: makeNote(), ...props },
    shallow: true,
    global: { stubs: { MkMfm: true, MkAvatar: true, AppTime: true } },
  })
}

beforeEach(() => {
  setupStores()
})

describe('MkNote の画面外判定 (nearViewport)', () => {
  it('nearViewport を渡さない面は画面外扱いにしない (MFM のアニメを止めない)', () => {
    const wrapper = mountNote()
    expect(wrapper.props('nearViewport')).toBeUndefined()
    expect(wrapper.find('[class*="offscreen"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('仮想スクローラが false を渡した行だけ画面外扱いにする', () => {
    const wrapper = mountNote({ nearViewport: false })
    expect(wrapper.find('[class*="offscreen"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

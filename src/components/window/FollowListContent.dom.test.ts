// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h, nextTick } from 'vue'
import { useAccountsStore } from '@/stores/accounts'

const getFollowing = vi.fn()
const getFollowers = vi.fn()
const getUserRelations = vi.fn(async () => [])

vi.mock('@/composables/useMultiAccountAdapters', () => ({
  useMultiAccountAdapters: () => ({
    forView: async () => ({
      api: { getFollowing, getFollowers, getUserRelations },
    }),
  }),
}))
vi.mock('@/composables/useWindowExternalLink', () => ({
  useWindowExternalLink: vi.fn(),
}))
vi.mock('@/components/common/MkUserListItem.vue', () => ({
  default: defineComponent({
    props: { user: { type: Object, required: true } },
    setup: (p) => () => h('div', { class: 'row' }, p.user.id),
  }),
}))
vi.mock('@/components/common/MkFollowButton.vue', () => ({
  default: defineComponent({ setup: () => () => null }),
}))

import FollowListContent from './FollowListContent.vue'

let app: App | null = null
let container: HTMLElement | null = null

async function flush() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/** フォロー関係の記録 (id は記録のもの) と、その相手のユーザー */
function relation(recordId: string, userId: string) {
  return {
    id: recordId,
    followee: { id: userId, username: userId, host: null, name: null },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAccountsStore().accounts = [
    {
      id: 'a',
      host: 'example.test',
      userId: 'me',
      username: 'me',
      displayName: null,
      avatarUrl: null,
      software: 'misskey-dev/misskey',
      hasToken: true,
    },
  ]
  getFollowing.mockReset()
  getFollowers.mockReset()
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

/**
 * 本家の users/following は「フォロー関係の記録」の id で前後を絞る。次のページの
 * 起点にユーザーの id を渡すと取りこぼしと重複が出る (#1360)
 */
describe('FollowListContent のページング', () => {
  it('次のページの起点は、末尾のユーザーではなくフォロー関係の記録の id', async () => {
    getFollowing
      .mockResolvedValueOnce([
        relation('rel-2', 'user-x'),
        relation('rel-1', 'user-y'),
      ])
      .mockResolvedValueOnce([])
    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp({
      render: () => h(FollowListContent, { accountId: 'a', userId: 'me' }),
    })
    app.mount(container)
    await flush()
    expect(getFollowing).toHaveBeenCalledTimes(1)

    container
      .querySelector('.row')
      ?.parentElement?.dispatchEvent(new Event('scroll'))
    await flush()

    expect(getFollowing).toHaveBeenCalledTimes(2)
    expect(getFollowing.mock.calls[1]?.[1]).toEqual({
      limit: 30,
      untilId: 'rel-1',
    })
  })
})

// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import type { NormalizedUserDetail } from '@/adapters/types'
import {
  clearUserDetailCache,
  fetchUserDetail,
} from '@/services/userDetailCache'
import { type Account, useAccountsStore } from '@/stores/accounts'
import MkUserPopup from './MkUserPopup.vue'

vi.mock('@/composables/useMultiAccountAdapters', () => ({
  useMultiAccountAdapters: () => ({ forView: async () => null }),
}))

let app: App | null = null
let container: HTMLElement | null = null

const EMOJI_URL = 'https://remote.example/emoji/blobcat.png'

/** リモートユーザー。絵文字は相手のサーバーのもので、対応表 (`emojis`) が付いてくる */
function remoteUser(): NormalizedUserDetail {
  return {
    id: 'u-remote',
    username: 'alice',
    host: 'remote.example',
    name: 'Alice :blobcat:',
    description: 'hello :blobcat:',
    avatarUrl: null,
    emojis: { blobcat: EMOJI_URL },
    notesCount: 0,
    followingCount: 0,
    followersCount: 0,
  } as unknown as NormalizedUserDetail
}

async function mountPopup() {
  await fetchUserDetail('acc-1', 'u-remote', async () => remoteUser())
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(MkUserPopup, {
    userId: 'u-remote',
    accountId: 'acc-1',
    x: 0,
    y: 0,
  })
  app.use(createPinia())
  app.mount(container)
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  clearUserDetailCache()
  useAccountsStore().accounts = [
    {
      id: 'acc-1',
      host: 'local.example',
      userId: 'me',
      username: 'me',
      displayName: null,
      avatarUrl: null,
      software: 'misskey-dev/misskey',
      hasToken: true,
    } as Account,
  ]
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

/** その URL を指す画像があるか (中継の URL に包まれていても元の URL を含む) */
function hasEmojiImage(root: Element | null): boolean {
  return [...(root?.querySelectorAll('img') ?? [])].some((img) =>
    decodeURIComponent(img.getAttribute('src') ?? '').includes(EMOJI_URL),
  )
}

describe('MkUserPopup: リモートユーザーのカスタム絵文字 (#1386)', () => {
  it('自己紹介の中の絵文字も、ユーザー情報に付いてくる対応表で出す', async () => {
    await mountPopup()
    const desc = [...(container?.querySelectorAll('div') ?? [])].find(
      (el) =>
        el.textContent?.trim().startsWith('hello') &&
        el.children.length > 0 &&
        !el.textContent?.includes('Alice'),
    )
    expect(desc).toBeTruthy()
    expect(hasEmojiImage(desc ?? null)).toBe(true)
  })

  it('表示名の中の絵文字も出す', async () => {
    await mountPopup()
    expect(hasEmojiImage(container)).toBe(true)
  })
})

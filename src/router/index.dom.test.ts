import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { router } from './index'

// ガードの検証にビュー本体は不要。実コンポーネント (特に DeckPage) の
// lazy import はデッキ全体を連れてきて遅く、テストが timeout しうる
vi.mock('@/views/DeckPage.vue', () => ({ default: { render: () => null } }))
vi.mock('@/views/NoteDetailPage.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/views/NotFoundPage.vue', () => ({
  default: { render: () => null },
}))

// tauri-specta bindings: 全コマンドを空成功で応答
vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get:
        () =>
        (..._args: unknown[]) =>
          Promise.resolve({ status: 'ok', data: [] }),
    },
  ),
}))

function markAccountsLoaded(accounts: Account[] = []) {
  const store = useAccountsStore()
  store.accounts.splice(0, store.accounts.length, ...accounts)
  store.isLoaded = true
}

function account(id: string): Account {
  return {
    id,
    host: 'example.com',
    userId: `uid-${id}`,
    username: id,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
  }
}

describe('router guard: アカウント0件でもデッキを隠さない (#692)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    // チュートリアル完了済み = 旧実装で /login 強制が発動していた条件
    useSettingsStore().set('tutorial.completed', true)
  })

  it('0件でもデッキ (/) は login へリダイレクトされない', async () => {
    markAccountsLoaded([])
    await router.push('/')
    expect(router.currentRoute.value.name).toBe('deck')
  })

  it('0件でアカウント必須ページへ遷移するとデッキへ戻される', async () => {
    markAccountsLoaded([])
    await router.push('/note/acc-x/note-y')
    expect(router.currentRoute.value.name).toBe('deck')
  })

  it('/login ルートは撤去済みで catch-all (public) に落ちる', async () => {
    markAccountsLoaded([])
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('not-found')
  })

  it('アカウントがあればアカウント必須ページへそのまま遷移できる', async () => {
    markAccountsLoaded([account('acc-1')])
    await router.push('/note/acc-1/note-y')
    expect(router.currentRoute.value.name).toBe('note-detail')
  })
})

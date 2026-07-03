import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// #700: 削除/ログアウトは「資格情報の無効化 → backend 切断」の順でなければ
// ならない。切断が先だと、購読の自己回復リトライが有効な資格情報で WS を
// 復活させ、誰にも切断されないまま残る競合窓ができる。
const callOrder: string[] = []

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      deleteAccount: vi.fn(async () => {
        callOrder.push('deleteAccount')
        return { status: 'ok', data: null }
      }),
      logoutAccount: vi.fn(async () => {
        callOrder.push('logoutAccount')
        return { status: 'ok', data: null }
      }),
    },
  }
})

vi.mock('@/adapters/factory', () => ({
  destroyAdapter: vi.fn(() => {
    callOrder.push('destroyAdapter')
  }),
}))

vi.mock('@/utils/storage', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/storage')>('@/utils/storage')
  return {
    STORAGE_KEYS: actual.STORAGE_KEYS,
    removeStorage: vi.fn(),
  }
})

vi.mock('@/composables/useMemos', () => ({
  deleteAllMemos: vi.fn(),
}))

import { type Account, useAccountsStore } from './accounts'

function makeAccount(id: string): Account {
  return {
    id,
    host: 'example.test',
    userId: `user-${id}`,
    username: `user-${id}`,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
  }
}

describe('accounts store: 削除/ログアウトの操作順序 (#700)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    callOrder.length = 0
  })

  it('removeAccount は資格情報を無効化してから backend を切断する', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount('acc-1'))

    await store.removeAccount('acc-1')

    expect(callOrder).toEqual(['deleteAccount', 'destroyAdapter'])
    expect(store.accounts).toHaveLength(0)
  })

  it('logoutAccount はトークンを無効化してから backend を切断する', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount('acc-1'))

    await store.logoutAccount('acc-1')

    expect(callOrder).toEqual(['logoutAccount', 'destroyAdapter'])
    expect(store.accounts[0]?.hasToken).toBe(false)
  })
})

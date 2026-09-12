// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/stores/accounts'
import { useAccountsStore } from '@/stores/accounts'

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      deleteAccount: vi.fn(async () => ({ status: 'ok', data: null })),
      logoutAccount: vi.fn(async () => ({ status: 'ok', data: null })),
    },
  }
})

vi.mock('@/adapters/factory', () => ({
  destroyAdapter: vi.fn(),
}))

function createTestAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'test-1',
    host: 'example.com',
    userId: 'user-1',
    username: 'testuser',
    displayName: 'Test User',
    avatarUrl: null,
    software: 'misskey',
    hasToken: true,
    ...overrides,
  }
}

describe('accounts store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with empty accounts', () => {
    const store = useAccountsStore()
    expect(store.accounts).toHaveLength(0)
    expect(store.fallbackAccount).toBeNull()
  })

  it('adds an account', async () => {
    const store = useAccountsStore()
    const account = createTestAccount()

    store.addAccount(account)

    expect(store.accounts).toHaveLength(1)
    expect(store.fallbackAccount).toEqual(account)
  })

  it('fallbackAccount は登録順の先頭でトークンを持つアカウント (#941)', async () => {
    const store = useAccountsStore()
    store.addAccount(
      createTestAccount({
        id: 'g',
        host: 'server-a.com',
        userId: 'u0',
        hasToken: false,
      }),
    )
    store.addAccount(
      createTestAccount({ id: 'a1', host: 'server-a.com', userId: 'u1' }),
    )
    store.addAccount(
      createTestAccount({ id: 'a2', host: 'server-b.com', userId: 'u2' }),
    )

    expect(store.fallbackAccount?.id).toBe('a1')
  })

  it('removes an account', async () => {
    const store = useAccountsStore()
    store.addAccount(createTestAccount({ id: 'a1', userId: 'u1' }))
    store.addAccount(createTestAccount({ id: 'a2', userId: 'u2' }))

    await store.removeAccount('a1')

    expect(store.accounts).toHaveLength(1)
    expect(store.fallbackAccount?.id).toBe('a2')
  })

  it('groups accounts by server', async () => {
    const store = useAccountsStore()
    store.addAccount(
      createTestAccount({ id: 'a1', host: 'server-a.com', userId: 'u1' }),
    )
    store.addAccount(
      createTestAccount({ id: 'a2', host: 'server-a.com', userId: 'u2' }),
    )
    store.addAccount(
      createTestAccount({ id: 'a3', host: 'server-b.com', userId: 'u3' }),
    )

    const grouped = store.accountsByServer
    expect(grouped.get('server-a.com')).toHaveLength(2)
    expect(grouped.get('server-b.com')).toHaveLength(1)
  })
})

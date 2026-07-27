import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initAdapterFor } from '@/adapters/factory'
import { type Account, useAccountsStore } from '@/stores/accounts'
import {
  getApiAdapter,
  pickAccountId,
  resolveAccountId,
} from './accountContext'

vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async (_host: string, accountId: string) => ({
    adapter: { api: { _accountId: accountId } },
  })),
}))

const initAdapterForMock = vi.mocked(initAdapterFor)

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    host: 'example.com',
    userId: 'u1',
    username: 'alice',
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('pickAccountId', () => {
  it('文字列は trim して返し、空文字・非文字列は undefined', () => {
    expect(pickAccountId(' acc-1 ')).toBe('acc-1')
    expect(pickAccountId('')).toBeUndefined()
    expect(pickAccountId('   ')).toBeUndefined()
    expect(pickAccountId(42)).toBeUndefined()
    expect(pickAccountId(undefined)).toBeUndefined()
  })
})

describe('resolveAccountId (#821 解決順)', () => {
  it('明示的な params.accountId が最優先', () => {
    useAccountsStore().activeAccountId = 'acc-active'
    expect(resolveAccountId('acc-explicit', { accountId: 'acc-ctx' })).toBe(
      'acc-explicit',
    )
  })

  it('明示指定が無ければ ctx.accountId (呼び出し文脈)', () => {
    useAccountsStore().activeAccountId = 'acc-active'
    expect(resolveAccountId(undefined, { accountId: 'acc-ctx' })).toBe(
      'acc-ctx',
    )
    // 空文字は「明示指定なし」として扱う
    expect(resolveAccountId('  ', { accountId: 'acc-ctx' })).toBe('acc-ctx')
  })

  it('文脈も無ければ activeAccountId へフォールバック (従来挙動)', () => {
    useAccountsStore().activeAccountId = 'acc-active'
    expect(resolveAccountId(undefined, undefined)).toBe('acc-active')
    expect(resolveAccountId(undefined, {})).toBe('acc-active')
  })

  it('どれも無ければ throw', () => {
    expect(() => resolveAccountId(undefined, {})).toThrow('No active account')
  })
})

describe('getApiAdapter', () => {
  it('解決したアカウントの host/id で initAdapterFor を呼ぶ', async () => {
    const store = useAccountsStore()
    store.accounts.push(
      makeAccount({ id: 'acc-1', host: 'a.example' }),
      makeAccount({ id: 'acc-2', host: 'b.example', userId: 'u2' }),
    )
    store.activeAccountId = 'acc-1'
    const api = await getApiAdapter(undefined, { accountId: 'acc-2' })
    expect(initAdapterForMock).toHaveBeenCalledWith('b.example', 'acc-2')
    expect(api).toEqual({ _accountId: 'acc-2' })
  })

  it('存在しないアカウント ID は throw', async () => {
    useAccountsStore().activeAccountId = 'acc-ghost'
    await expect(getApiAdapter(undefined)).rejects.toThrow(
      'Account "acc-ghost" not found',
    )
  })
})

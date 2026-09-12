import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Account } from '@/stores/accounts'
import { useAccountsStore } from '@/stores/accounts'
import {
  ACCOUNT_BUILTIN_CAPABILITIES,
  accountCurrentCapability,
  accountListCapability,
} from './account'

const SAMPLE: Account = {
  id: 'acc-1',
  host: 'misskey.example',
  userId: 'u1',
  username: 'taka',
  displayName: 'Taka',
  avatarUrl: null,
  software: 'misskey-dev/misskey',
  hasToken: true,
}

describe('account.current capability', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('declares account.read permission and aiTool: true', () => {
    expect(accountCurrentCapability.permissions).toEqual(['account.read'])
    expect(accountCurrentCapability.aiTool).toBe(true)
    expect(accountCurrentCapability.signature?.returns?.type).toBe('object')
  })

  it('returns null when the calling context has no account (#941)', () => {
    useAccountsStore().accounts = [SAMPLE]
    expect(accountCurrentCapability.execute()).toBeNull()
    expect(
      accountCurrentCapability.execute({}, { principal: { kind: 'ai.chat' } }),
    ).toBeNull()
  })

  it('returns the context account stripped of credential fields', () => {
    const store = useAccountsStore()
    store.accounts = [SAMPLE]
    const result = accountCurrentCapability.execute(
      {},
      { principal: { kind: 'ai.chat' }, accountId: 'acc-1' },
    ) as Record<string, unknown>
    expect(result).toMatchObject({
      id: 'acc-1',
      host: 'misskey.example',
      username: 'taka',
    })
    // 想定外の credential 流入があっても出ないことを念のため検証
    expect(JSON.stringify(result)).not.toContain('"i":')
    expect(JSON.stringify(result)).not.toContain('"token":')
  })
})

describe('account.list capability', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('returns an empty array when no accounts are loaded', () => {
    const result = accountListCapability.execute()
    expect(result).toEqual([])
  })

  it('returns all accounts (stripped) when loaded', () => {
    const store = useAccountsStore()
    store.accounts = [SAMPLE, { ...SAMPLE, id: 'acc-2', username: 'taka2' }]
    const result = accountListCapability.execute() as Array<
      Record<string, unknown>
    >
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.id)).toEqual(['acc-1', 'acc-2'])
  })
})

describe('ACCOUNT_BUILTIN_CAPABILITIES', () => {
  it('contains current / list (switch は #941 で廃止)', () => {
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toContain(accountCurrentCapability)
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toContain(accountListCapability)
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toHaveLength(2)
  })
})

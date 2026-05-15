import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Account } from '@/stores/accounts'
import { useAccountsStore } from '@/stores/accounts'
import {
  ACCOUNT_BUILTIN_CAPABILITIES,
  accountCurrentCapability,
  accountListCapability,
  accountSwitchCapability,
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

  it('returns null when no active account exists', () => {
    expect(accountCurrentCapability.execute()).toBeNull()
  })

  it('returns the active account stripped of credential fields', () => {
    const store = useAccountsStore()
    store.accounts = [SAMPLE]
    store.activeAccountId = 'acc-1'
    const result = accountCurrentCapability.execute() as Record<string, unknown>
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

describe('account.switch capability', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('declares account.write permission and aiTool: true', () => {
    expect(accountSwitchCapability.permissions).toEqual(['account.write'])
    expect(accountSwitchCapability.aiTool).toBe(true)
  })

  it('preflight rejects missing or non-string id', async () => {
    expect(await accountSwitchCapability.preflight?.({})).toMatchObject({
      error: expect.stringContaining('id'),
    })
    expect(
      await accountSwitchCapability.preflight?.({ id: 123 }),
    ).toMatchObject({
      error: expect.stringContaining('id'),
    })
  })

  it('preflight rejects id that is not logged in', async () => {
    const store = useAccountsStore()
    store.accounts = [SAMPLE]
    expect(
      await accountSwitchCapability.preflight?.({ id: 'acc-missing' }),
    ).toMatchObject({
      error: expect.stringContaining('not logged in'),
    })
  })

  it('switches active account and returns { ok: true, id }', () => {
    const store = useAccountsStore()
    store.accounts = [SAMPLE, { ...SAMPLE, id: 'acc-2', username: 'taka2' }]
    store.activeAccountId = 'acc-1'
    const result = accountSwitchCapability.execute({ id: 'acc-2' })
    expect(result).toEqual({ ok: true, id: 'acc-2' })
    expect(store.activeAccountId).toBe('acc-2')
  })
})

describe('ACCOUNT_BUILTIN_CAPABILITIES', () => {
  it('contains all three capabilities', () => {
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toContain(accountCurrentCapability)
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toContain(accountListCapability)
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toContain(accountSwitchCapability)
  })
})

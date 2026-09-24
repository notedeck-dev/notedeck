import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Account } from '@/stores/accounts'
import {
  ACCOUNT_BUILTIN_CAPABILITIES,
  accountCurrentCapability,
  accountListCapability,
} from './account'

const _SAMPLE: Account = {
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
})

describe('account.list capability', () => {
  it('declares account.read permission, aiTool: true and an array return', () => {
    expect(accountListCapability.permissions).toEqual(['account.read'])
    expect(accountListCapability.aiTool).toBe(true)
    expect(accountListCapability.signature?.returns?.type).toBe('array')
  })
})

describe('ACCOUNT_BUILTIN_CAPABILITIES', () => {
  it('contains current / list (switch は #941 で廃止)', () => {
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toContain(accountCurrentCapability)
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toContain(accountListCapability)
    expect(ACCOUNT_BUILTIN_CAPABILITIES).toHaveLength(2)
  })
})

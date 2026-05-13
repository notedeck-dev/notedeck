import { describe, expect, it } from 'vitest'
import {
  USER_BUILTIN_CAPABILITIES,
  userLookupCapability,
  userSearchCapability,
} from './user'

describe('user.lookup capability', () => {
  it('declares account.read permission and aiTool: true', () => {
    expect(userLookupCapability.permissions).toEqual(['account.read'])
    expect(userLookupCapability.aiTool).toBe(true)
    expect(userLookupCapability.id).toBe('user.lookup')
    expect(userLookupCapability.signature?.returns?.type).toBe('object')
  })

  it('marks username as required and host as optional', () => {
    const params = userLookupCapability.signature?.params
    expect(params?.username?.optional).not.toBe(true)
    expect(params?.host?.optional).toBe(true)
  })

  it('throws when username is missing or blank', async () => {
    await expect(userLookupCapability.execute({})).rejects.toThrow(
      /username is required/,
    )
    await expect(
      userLookupCapability.execute({ username: '   ' }),
    ).rejects.toThrow(/username is required/)
  })
})

describe('user.search capability', () => {
  it('declares account.read permission, aiTool, cheap, array return', () => {
    expect(userSearchCapability.id).toBe('user.search')
    expect(userSearchCapability.permissions).toEqual(['account.read'])
    expect(userSearchCapability.aiTool).toBe(true)
    expect(userSearchCapability.signature?.cheap).toBe(true)
    expect(userSearchCapability.signature?.returns?.type).toBe('array')
  })

  it('marks query as required and limit/accountId as optional', () => {
    const params = userSearchCapability.signature?.params
    expect(params?.query?.optional).not.toBe(true)
    expect(params?.limit?.optional).toBe(true)
    expect(params?.accountId?.optional).toBe(true)
  })
})

describe('USER_BUILTIN_CAPABILITIES', () => {
  it('contains user.lookup + user.search', () => {
    const ids = USER_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['user.lookup', 'user.search'])
  })
})

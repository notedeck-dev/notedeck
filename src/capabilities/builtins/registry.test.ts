import { describe, expect, it } from 'vitest'
import {
  REGISTRY_BUILTIN_CAPABILITIES,
  registryGetCapability,
  registryListKeysCapability,
  registrySetCapability,
} from './registry'

describe('registry capabilities — declaration', () => {
  it('registry.listKeys: account.read, cheap', () => {
    expect(registryListKeysCapability.id).toBe('registry.listKeys')
    expect(registryListKeysCapability.permissions).toEqual(['account.read'])
    expect(registryListKeysCapability.signature?.cheap).toBe(true)
    expect(
      registryListKeysCapability.signature?.params?.scope?.optional,
    ).not.toBe(true)
  })

  it('registry.get: account.read, cheap, requires scope+key', () => {
    expect(registryGetCapability.id).toBe('registry.get')
    expect(registryGetCapability.permissions).toEqual(['account.read'])
    expect(registryGetCapability.signature?.cheap).toBe(true)
    expect(registryGetCapability.signature?.params?.key?.optional).not.toBe(
      true,
    )
  })

  it('registry.set: account.write + warning confirmation', () => {
    expect(registrySetCapability.id).toBe('registry.set')
    expect(registrySetCapability.permissions).toEqual(['account.write'])
    expect(typeof registrySetCapability.requiresConfirmation).toBe('function')
  })
})

describe('REGISTRY_BUILTIN_CAPABILITIES', () => {
  it('contains listKeys / get / set / delete', () => {
    const ids = REGISTRY_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'registry.delete',
      'registry.get',
      'registry.listKeys',
      'registry.set',
    ])
  })
})

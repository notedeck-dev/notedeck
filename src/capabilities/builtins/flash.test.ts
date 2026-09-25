import { describe, expect, it } from 'vitest'
import {
  FLASH_BUILTIN_CAPABILITIES,
  flashListCapability,
  flashShowCapability,
} from './flash'

describe('flash capabilities — declaration', () => {
  it('flash.list: account.read, cheap, requires endpoint', () => {
    expect(flashListCapability.id).toBe('flash.list')
    expect(flashListCapability.permissions).toEqual(['account.read'])
    expect(flashListCapability.signature?.cheap).toBe(true)
    expect(flashListCapability.signature?.returns?.type).toBe('array')
    expect(flashListCapability.signature?.params?.endpoint?.optional).not.toBe(
      true,
    )
  })

  it('flash.show: account.read, requires flashId', () => {
    expect(flashShowCapability.id).toBe('flash.show')
    expect(flashShowCapability.permissions).toEqual(['account.read'])
    expect(flashShowCapability.signature?.params?.flashId?.optional).not.toBe(
      true,
    )
  })
})

describe('FLASH_BUILTIN_CAPABILITIES', () => {
  it('contains list / show', () => {
    const ids = FLASH_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['flash.list', 'flash.show'])
  })
})

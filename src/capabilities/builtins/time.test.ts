import { describe, expect, it } from 'vitest'
import { BUILTIN_CAPABILITIES, timeNowCapability } from './time'

describe('time.now capability', () => {
  it('has aiTool: true and zero permissions', () => {
    expect(timeNowCapability.aiTool).toBe(true)
    expect(timeNowCapability.permissions).toEqual([])
  })

  it('declares a string return signature', () => {
    expect(timeNowCapability.signature?.returns?.type).toBe('string')
  })

  it('BUILTIN_CAPABILITIES includes time.now', () => {
    expect(BUILTIN_CAPABILITIES).toContain(timeNowCapability)
  })
})

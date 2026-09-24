import { describe, expect, it } from 'vitest'
import { ROLE_BUILTIN_CAPABILITIES, roleNotesCapability } from './role'

describe('role.notes capability', () => {
  it('declares notes.read permission, aiTool, requires roleId', () => {
    expect(roleNotesCapability.id).toBe('role.notes')
    expect(roleNotesCapability.permissions).toEqual(['notes.read'])
    expect(roleNotesCapability.aiTool).toBe(true)
    expect(roleNotesCapability.signature?.params?.roleId?.optional).not.toBe(
      true,
    )
    expect(roleNotesCapability.signature?.params?.limit?.optional).toBe(true)
  })
})

describe('ROLE_BUILTIN_CAPABILITIES', () => {
  it('contains role.notes only', () => {
    const ids = ROLE_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['role.notes'])
  })
})

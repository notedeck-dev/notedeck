import { describe, expect, it } from 'vitest'
import {
  extractSkillIdFromIdentity,
  isPersonaIdentityId,
  personaIdentityId,
} from './identityId'

describe('identity id helpers', () => {
  it('personaIdentityId prefixes skill: to skill id', () => {
    expect(personaIdentityId('aizu-9k2x')).toBe('skill:aizu-9k2x')
  })

  it('isPersonaIdentityId detects skill: prefix', () => {
    expect(isPersonaIdentityId('skill:aizu')).toBe(true)
    expect(isPersonaIdentityId('acc-1234')).toBe(false)
    expect(isPersonaIdentityId('')).toBe(false)
  })

  it('extractSkillIdFromIdentity strips skill: prefix', () => {
    expect(extractSkillIdFromIdentity('skill:aizu-9k2x')).toBe('aizu-9k2x')
    expect(extractSkillIdFromIdentity('acc-1234')).toBe(null)
    expect(extractSkillIdFromIdentity('skill:')).toBe(null)
  })
})

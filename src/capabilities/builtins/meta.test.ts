import { describe, expect, it } from 'vitest'
import { META_BUILTIN_CAPABILITIES } from './meta'

describe('meta capabilities — declaration', () => {
  it('all are aiTool:true with no permissions (= 機密なし)', () => {
    for (const cap of META_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id}.aiTool`).toBe(true)
      expect(cap.permissions, `${cap.id}.permissions`).toEqual([])
      expect(cap.signature?.cheap, `${cap.id}.cheap`).toBe(true)
    }
  })
})

describe('META_BUILTIN_CAPABILITIES', () => {
  it('contains 5 meta capabilities (incl. heartbeat read)', () => {
    const ids = META_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'meta.activeSkills',
      'meta.config',
      'meta.heartbeat',
      'meta.permissions',
      'meta.persona',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/composables/useAiConfig'
import {
  META_BUILTIN_CAPABILITIES,
  metaConfigCapability,
  metaPermissionsCapability,
  metaPersonaCapability,
} from './meta'

describe('meta capabilities — declaration', () => {
  it('all are aiTool:true with no permissions (= 機密なし)', () => {
    for (const cap of META_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id}.aiTool`).toBe(true)
      expect(cap.permissions, `${cap.id}.permissions`).toEqual([])
      expect(cap.signature?.cheap, `${cap.id}.cheap`).toBe(true)
    }
  })
})

describe('meta.permissions', () => {
  it('returns preset + resolved map', () => {
    const cfg = defaultConfig()
    const result = metaPermissionsCapability.execute({}, { aiConfig: cfg }) as {
      preset: string
      resolved: Record<string, boolean>
    }
    expect(result.preset).toBe(cfg.permissions.preset)
    expect(typeof result.resolved['ai.invoke']).toBe('boolean')
    expect(typeof result.resolved['skills.write']).toBe('boolean')
  })

  it('throws without ctx.aiConfig', () => {
    expect(() => metaPermissionsCapability.execute({})).toThrow(/aiConfig/)
  })
})

describe('meta.persona', () => {
  it('returns null when personaSkillId is not set', () => {
    const cfg = defaultConfig()
    const result = metaPersonaCapability.execute({}, { aiConfig: cfg })
    expect(result).toBeNull()
  })
})

describe('meta.config', () => {
  it('returns provider/model/dataSourcesEnabled but NEVER endpoint or API key', () => {
    const cfg = defaultConfig()
    const result = metaConfigCapability.execute({}, { aiConfig: cfg }) as {
      provider: string
      model: string
      dataSourcesEnabled: Record<string, boolean>
      endpoint?: unknown
      apiKey?: unknown
    }
    expect(typeof result.provider).toBe('string')
    expect(typeof result.model).toBe('string')
    expect(result.dataSourcesEnabled.currentAccount).toBeDefined()
    // 機密フィールドが漏れていないこと
    expect(result).not.toHaveProperty('endpoint')
    expect(result).not.toHaveProperty('apiKey')
  })

  it('throws without ctx.aiConfig', () => {
    expect(() => metaConfigCapability.execute({})).toThrow(/aiConfig/)
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

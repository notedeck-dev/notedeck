import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/composables/useAiConfig'
import { usePermissionsConfig } from '@/permissions/store'
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
  it('returns principal + preset + resolved map for ai.chat', () => {
    const { file } = usePermissionsConfig()
    const result = metaPermissionsCapability.execute(
      {},
      { principal: { kind: 'ai.chat' } },
    ) as {
      principal: string
      preset: string
      resolved: Record<string, boolean>
    }
    expect(result.principal).toBe('ai.chat')
    expect(result.preset).toBe(file.value.principals['ai.chat']?.preset)
    expect(typeof result.resolved['ai.invoke']).toBe('boolean')
    expect(typeof result.resolved['skills.write']).toBe('boolean')
  })

  it('returns external profile for external principal', () => {
    const { file } = usePermissionsConfig()
    const result = metaPermissionsCapability.execute(
      {},
      { principal: { kind: 'external' } },
    ) as { principal: string; preset: string }
    expect(result.principal).toBe('external')
    expect(result.preset).toBe(file.value.principals.external?.preset)
  })

  it('returns all-true map with preset:null for user principal', () => {
    const result = metaPermissionsCapability.execute(
      {},
      { principal: { kind: 'user' } },
    ) as { principal: string; preset: null; resolved: Record<string, boolean> }
    expect(result.principal).toBe('user')
    expect(result.preset).toBeNull()
    expect(Object.values(result.resolved).every((v) => v === true)).toBe(true)
  })

  it('throws without ctx.principal', () => {
    expect(() => metaPermissionsCapability.execute({})).toThrow(/principal/)
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
  it('returns protocol/model/dataSourcesEnabled but NEVER endpoint or API key', () => {
    const cfg = defaultConfig()
    const result = metaConfigCapability.execute({}, { aiConfig: cfg }) as {
      protocol: string
      model: string
      dataSourcesEnabled: Record<string, boolean>
      endpoint?: unknown
      apiKey?: unknown
    }
    expect(typeof result.protocol).toBe('string')
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

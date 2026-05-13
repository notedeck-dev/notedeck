import { describe, expect, it } from 'vitest'
import {
  aiListPersonasCapability,
  aiSetPersonaCapability,
  PERSONA_BUILTIN_CAPABILITIES,
} from './persona'

// Note: execute は useAiConfig / useSkillsStore を呼ぶため unit 環境では走らない。
// capability 定義と confirmation メッセージ生成のみ検証する。

describe('persona capabilities — declaration', () => {
  it('ai.listPersonas: skills.read permission, aiTool true, cheap', () => {
    expect(aiListPersonasCapability.id).toBe('ai.listPersonas')
    expect(aiListPersonasCapability.permissions).toEqual(['skills.read'])
    expect(aiListPersonasCapability.signature?.cheap).toBe(true)
    expect(aiListPersonasCapability.signature?.returns?.type).toBe('array')
  })

  it('ai.setPersona: ai.persona.write permission, confirmation, requires skillId', () => {
    expect(aiSetPersonaCapability.id).toBe('ai.setPersona')
    expect(aiSetPersonaCapability.permissions).toEqual(['ai.persona.write'])
    expect(typeof aiSetPersonaCapability.requiresConfirmation).toBe('function')
    expect(
      aiSetPersonaCapability.signature?.params?.skillId?.optional,
    ).not.toBe(true)
  })
})

// Note: requiresConfirmation 内部で useSkillsStore() を呼ぶため、Pinia 無し
// の unit 環境ではメッセージ生成テストは走らない。実 confirmation UX は実機で確認。

describe('PERSONA_BUILTIN_CAPABILITIES', () => {
  it('contains listPersonas / setPersona', () => {
    const ids = PERSONA_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['ai.listPersonas', 'ai.setPersona'])
  })

  it('all capabilities are exposed to AI (aiTool: true)', () => {
    for (const cap of PERSONA_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} should be aiTool`).toBe(true)
    }
  })
})

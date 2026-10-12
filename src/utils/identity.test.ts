import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAccountsStore } from '@/stores/accounts'
import { useSkillsStore } from '@/stores/skills'
import { listPersonaIdentities, resolveIdentity } from './identity'

// ID の表記規則は src/services/identityId.test.ts。ここは store を引く解決だけ

function makeSkill(
  id: string,
  partial: {
    name?: string
    isPersona?: boolean
    iconUrl?: string
    description?: string
  } = {},
) {
  return {
    id,
    name: partial.name ?? id,
    description: partial.description,
    iconUrl: partial.iconUrl,
    scope: { kind: 'none' } as const,
    content: 'persona body',
    extra: {
      version: '0.1.0',
      mode: 'manual' as const,
      triggers: [],
      builtIn: false,
      cheapCheckCapabilities: [],
      isPersona: partial.isPersona ?? false,
    },
  }
}

describe('identity resolution', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('resolveIdentity returns null for unknown / dangling ids', () => {
    expect(resolveIdentity('')).toBe(null)
    expect(resolveIdentity('skill:nonexistent')).toBe(null)
    expect(resolveIdentity('acc-nonexistent')).toBe(null)
  })

  it('resolveIdentity returns persona Identity for isPersona=true skill', async () => {
    const skills = useSkillsStore()
    await skills.add(
      makeSkill('aizu-9k2x', {
        name: '藍',
        isPersona: true,
        iconUrl: 'https://example.com/aizu.svg',
        description: 'aizu persona bio',
      }),
    )
    const id = resolveIdentity('skill:aizu-9k2x')
    expect(id).not.toBeNull()
    expect(id?.kind).toBe('persona')
    expect(id?.id).toBe('skill:aizu-9k2x')
    expect(id?.displayName).toBe('藍')
    expect(id?.avatarUrl).toBe('https://example.com/aizu.svg')
    expect(id?.bio).toBe('aizu persona bio')
  })

  it('resolveIdentity rejects skill without isPersona flag', async () => {
    const skills = useSkillsStore()
    // isPersona 無し (= false)
    await skills.add(makeSkill('tool-skill', { name: 'tool' }))
    expect(resolveIdentity('skill:tool-skill')).toBe(null)
  })

  it('listPersonaIdentities returns only isPersona=true skills', async () => {
    const skills = useSkillsStore()
    await skills.add(makeSkill('aizu', { isPersona: true }))
    await skills.add(makeSkill('tool'))
    await skills.add(makeSkill('orin', { isPersona: true }))
    const list = listPersonaIdentities()
    expect(list.map((p) => p.id).sort()).toEqual(['skill:aizu', 'skill:orin'])
  })

  it('resolveIdentity returns account Identity for non-skill ids (smoke test)', () => {
    // 実 accountsStore は Tauri 環境で初期化されるため、ここでは
    // accounts が空であることを確認するだけ (= null fallback)
    const accounts = useAccountsStore()
    expect(accounts.accounts.length).toBe(0)
    expect(resolveIdentity('acc-1234')).toBe(null)
  })
})

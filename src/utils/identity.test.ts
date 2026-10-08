import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAccountsStore } from '@/stores/accounts'
import { useSkillsStore } from '@/stores/skills'
import { listPersonaIdentities, resolveIdentity } from './identity'

// ID の表記規則は src/services/identityId.test.ts。ここは store を引く解決だけ
describe('identity resolution', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('resolveIdentity returns null for unknown / dangling ids', () => {
    expect(resolveIdentity('')).toBe(null)
    expect(resolveIdentity('skill:nonexistent')).toBe(null)
    expect(resolveIdentity('acc-nonexistent')).toBe(null)
  })

  it('resolveIdentity returns persona Identity for isPersona=true skill', () => {
    const skills = useSkillsStore()
    skills.add({
      id: 'aizu-9k2x',
      name: '藍',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      body: 'persona body',
      cheapCheckCapabilities: [],
      isPersona: true,
      iconUrl: 'https://example.com/aizu.svg',
      description: 'aizu persona bio',
    })
    const id = resolveIdentity('skill:aizu-9k2x')
    expect(id).not.toBeNull()
    expect(id?.kind).toBe('persona')
    expect(id?.id).toBe('skill:aizu-9k2x')
    expect(id?.displayName).toBe('藍')
    expect(id?.avatarUrl).toBe('https://example.com/aizu.svg')
    expect(id?.bio).toBe('aizu persona bio')
  })

  it('resolveIdentity rejects skill without isPersona flag', () => {
    const skills = useSkillsStore()
    skills.add({
      id: 'tool-skill',
      name: 'tool',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      body: '',
      cheapCheckCapabilities: [],
      // isPersona 未指定 (= false)
    })
    expect(resolveIdentity('skill:tool-skill')).toBe(null)
  })

  it('listPersonaIdentities returns only isPersona=true skills', () => {
    const skills = useSkillsStore()
    skills.add({
      id: 'aizu',
      name: 'aizu',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      body: '',
      cheapCheckCapabilities: [],
      isPersona: true,
    })
    skills.add({
      id: 'tool',
      name: 'tool',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      body: '',
      cheapCheckCapabilities: [],
    })
    skills.add({
      id: 'orin',
      name: 'orin',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      body: '',
      cheapCheckCapabilities: [],
      isPersona: true,
    })
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

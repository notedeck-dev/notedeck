import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { _internal, useSkillsStore } from '@/stores/skills'

describe('skills store / metaFromFrontmatter', () => {
  it('honors mode: heartbeat (新スキーマ / MisStore 配布)', () => {
    const meta = _internal.metaFromFrontmatter(
      { mode: 'heartbeat' },
      'body',
      'fallback-id',
    )
    expect(meta.mode).toBe('heartbeat')
  })

  it('unknown mode falls back to manual', () => {
    const meta = _internal.metaFromFrontmatter(
      { mode: 'bogus' },
      'body',
      'fallback-id',
    )
    expect(meta.mode).toBe('manual')
  })

  it('frontmatterFromMeta serializes mode (no separate heartbeat field)', () => {
    const fm = _internal.frontmatterFromMeta({
      id: 'x',
      name: 'X',
      version: '0.1.0',
      mode: 'heartbeat',
      triggers: [],
      scope: 'global',
      body: '',
      createdAt: 0,
      updatedAt: 0,
    })
    expect(fm.mode).toBe('heartbeat')
    expect('heartbeat' in fm).toBe(false)
  })
})

describe('skills store / setHeartbeat & heartbeatSkills', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('setHeartbeat(true) puts skill into mode=heartbeat', () => {
    const store = useSkillsStore()
    store.add({
      id: 's1',
      name: 'S1',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      scope: 'global',
      body: '',
    })
    store.setHeartbeat('s1', true)
    expect(store.get('s1')?.mode).toBe('heartbeat')
    expect(store.heartbeatSkills.map((s) => s.id)).toEqual(['s1'])
  })

  it('setHeartbeat(false) reverts mode to manual', () => {
    const store = useSkillsStore()
    store.add({
      id: 's1',
      name: 'S1',
      version: '0.1.0',
      mode: 'heartbeat',
      triggers: [],
      scope: 'global',
      body: '',
    })
    store.setHeartbeat('s1', false)
    expect(store.get('s1')?.mode).toBe('manual')
    expect(store.heartbeatSkills).toEqual([])
  })

  it('heartbeatSkills filters by mode, preserves declaration order', () => {
    const store = useSkillsStore()
    store.add({
      id: 'a',
      name: 'A',
      version: '0.1.0',
      mode: 'heartbeat',
      triggers: [],
      scope: 'global',
      body: '',
    })
    store.add({
      id: 'b',
      name: 'B',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      scope: 'global',
      body: '',
    })
    store.add({
      id: 'c',
      name: 'C',
      version: '0.1.0',
      mode: 'heartbeat',
      triggers: [],
      scope: 'global',
      body: '',
    })
    expect(store.heartbeatSkills.map((s) => s.id)).toEqual(['a', 'c'])
  })
})

describe('skills store / composedSystemPrompt with #491 extensions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('extraSkillIds includes session-only skills not in activeIds', () => {
    const store = useSkillsStore()
    // always-mode skill: 自動的に effective active
    store.add({
      id: 'a',
      name: 'A',
      version: '0.1.0',
      mode: 'always',
      triggers: [],
      scope: 'global',
      body: 'BODY-A',
      cheapCheckCapabilities: [],
    })
    // manual-mode skill: 明示 activate しない
    store.add({
      id: 'b',
      name: 'B',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      scope: 'global',
      body: 'BODY-B',
      cheapCheckCapabilities: [],
    })
    expect(store.composedSystemPrompt()).toBe('BODY-A')
    // extraSkillIds で session-only に b を含める
    expect(store.composedSystemPrompt(['b'])).toContain('BODY-A')
    expect(store.composedSystemPrompt(['b'])).toContain('BODY-B')
  })

  it('excludePersonaSkillsExcept removes other persona skills', () => {
    const store = useSkillsStore()
    // 2 個の always + isPersona skill
    store.add({
      id: 'aizu',
      name: 'aizu',
      version: '0.1.0',
      mode: 'always',
      triggers: [],
      scope: 'global',
      body: 'AIZU',
      cheapCheckCapabilities: [],
      isPersona: true,
    })
    store.add({
      id: 'orin',
      name: 'orin',
      version: '0.1.0',
      mode: 'always',
      triggers: [],
      scope: 'global',
      body: 'ORIN',
      cheapCheckCapabilities: [],
      isPersona: true,
    })
    // 通常: 両方が effective active 扱いで両方の body が出る
    const both = store.composedSystemPrompt()
    expect(both).toContain('AIZU')
    expect(both).toContain('ORIN')
    // session で persona='aizu' を選択 → aizu のみ含まれ orin は除外
    const aizuOnly = store.composedSystemPrompt([], 'aizu')
    expect(aizuOnly).toContain('AIZU')
    expect(aizuOnly).not.toContain('ORIN')
  })

  it('excludePersonaSkillsExcept does not affect non-persona skills', () => {
    const store = useSkillsStore()
    store.add({
      id: 'tool',
      name: 'tool',
      version: '0.1.0',
      mode: 'always',
      triggers: [],
      scope: 'global',
      body: 'TOOL',
      cheapCheckCapabilities: [],
    })
    store.add({
      id: 'aizu',
      name: 'aizu',
      version: '0.1.0',
      mode: 'always',
      triggers: [],
      scope: 'global',
      body: 'AIZU',
      cheapCheckCapabilities: [],
      isPersona: true,
    })
    // tool は isPersona=false なので exclusion フィルタの対象外
    const out = store.composedSystemPrompt([], 'aizu')
    expect(out).toContain('TOOL')
    expect(out).toContain('AIZU')
  })
})

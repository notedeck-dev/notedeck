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
      body: '',
    })
    store.add({
      id: 'b',
      name: 'B',
      version: '0.1.0',
      mode: 'manual',
      triggers: [],
      body: '',
    })
    store.add({
      id: 'c',
      name: 'C',
      version: '0.1.0',
      mode: 'heartbeat',
      triggers: [],
      body: '',
    })
    expect(store.heartbeatSkills.map((s) => s.id)).toEqual(['a', 'c'])
  })
})

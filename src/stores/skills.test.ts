// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', () => ({
  isTauri: false,
}))

import type { SkillMeta } from '@/stores/skills'
import { useSkillsStore } from '@/stores/skills'

function makeSkill(
  partial: Partial<SkillMeta> & Pick<SkillMeta, 'id'>,
): Omit<SkillMeta, 'createdAt' | 'updatedAt'> {
  return {
    name: partial.name ?? partial.id,
    version: '1.0.0',
    mode: 'trigger',
    triggers: [],
    scope: 'global',
    body: 'body',
    cheapCheckCapabilities: [],
    ...partial,
  }
}

describe('useSkillsStore.triggerMatchingSkillIds', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('returns ids whose triggers substring-match the input (mode=trigger)', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'guide', triggers: ['どこ', '使い方'] }))
    expect(store.triggerMatchingSkillIds('投稿はどこ?')).toEqual(['guide'])
    expect(store.triggerMatchingSkillIds('使い方を教えて')).toEqual(['guide'])
  })

  it('returns empty array when no trigger matches', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'guide', triggers: ['どこ', 'help'] }))
    expect(store.triggerMatchingSkillIds('今日の天気は')).toEqual([])
  })

  it('ignores skills whose mode is not "trigger"', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({ id: 'manual-skill', mode: 'manual', triggers: ['どこ'] }),
    )
    store.add(
      makeSkill({ id: 'always-skill', mode: 'always', triggers: ['どこ'] }),
    )
    store.add(
      makeSkill({
        id: 'heartbeat-skill',
        mode: 'heartbeat',
        triggers: ['どこ'],
      }),
    )
    expect(store.triggerMatchingSkillIds('どこ?')).toEqual([])
  })

  it('matches case-insensitively (e.g. Help / HELP / help)', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'guide', triggers: ['Help'] }))
    expect(store.triggerMatchingSkillIds('HELP me')).toEqual(['guide'])
    expect(store.triggerMatchingSkillIds('please help')).toEqual(['guide'])
  })

  it('returns all matching ids when multiple skills hit', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'guide', triggers: ['どこ'] }))
    store.add(makeSkill({ id: 'tour', triggers: ['使い方'] }))
    expect(store.triggerMatchingSkillIds('どこで使い方を見る?')).toEqual([
      'guide',
      'tour',
    ])
  })

  it('returns empty array for empty / whitespace input', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'guide', triggers: ['どこ'] }))
    expect(store.triggerMatchingSkillIds('')).toEqual([])
  })

  it('skips trigger skills with empty triggers[]', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'guide', triggers: [] }))
    expect(store.triggerMatchingSkillIds('どこ?')).toEqual([])
  })

  it('skips empty-string entries inside triggers[]', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'guide', triggers: ['', 'どこ'] }))
    expect(store.triggerMatchingSkillIds('xyz')).toEqual([])
    expect(store.triggerMatchingSkillIds('どこ?')).toEqual(['guide'])
  })
})

describe('useSkillsStore.remove (undo)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('returns an undo that restores the skill at its original position', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'a' }))
    store.add(makeSkill({ id: 'b', body: 'b body' }))
    store.add(makeSkill({ id: 'c' }))
    const undo = store.remove('b')
    expect(store.get('b')).toBeUndefined()
    expect(undo).toBeTypeOf('function')
    undo?.()
    expect(store.skills.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(store.get('b')?.body).toBe('b body')
  })

  it('returns undefined for unknown id', () => {
    const store = useSkillsStore()
    expect(store.remove('nope')).toBeUndefined()
  })

  it('restores the active state on undo', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'a', mode: 'manual' }))
    store.setActive('a', true)
    const undo = store.remove('a')
    expect(store.isActive('a')).toBe(false)
    undo?.()
    expect(store.isActive('a')).toBe(true)
  })

  it('does not duplicate when the same id was re-added before undo', () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'a' }))
    const undo = store.remove('a')
    store.add(makeSkill({ id: 'a', name: 'readded' }))
    undo?.()
    expect(store.skills.filter((s) => s.id === 'a')).toHaveLength(1)
    expect(store.get('a')?.name).toBe('readded')
  })
})

function tpl(
  id: string,
  fm: Record<string, unknown>,
): { id: string; filename: string; raw: string } {
  const yaml = Object.entries(fm)
    .map(([k, v]) =>
      Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`,
    )
    .join('\n')
  return { id, filename: `${id}.md`, raw: `---\n${yaml}\n---\nbody` }
}

describe('useSkillsStore.syncBuiltInsMetadata', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updates mode/triggers/version when template version is newer', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'plugin-author',
        mode: 'always',
        triggers: [],
        version: '1.0.0',
        builtIn: true,
      }),
    )
    store.syncBuiltInsMetadata([
      tpl('plugin-author', {
        id: 'plugin-author',
        name: 'プラグイン作者',
        version: '1.2.0',
        mode: 'trigger',
        triggers: ['プラグイン', 'plugin', 'aiscript'],
      }),
    ])
    const after = store.get('plugin-author')
    expect(after?.mode).toBe('trigger')
    expect(after?.triggers).toEqual(['プラグイン', 'plugin', 'aiscript'])
    expect(after?.version).toBe('1.2.0')
  })

  it('does NOT touch body / name / description (user edits preserved)', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'plugin-author',
        name: '私のプラグイン作者',
        body: 'user-edited body',
        description: 'edited',
        mode: 'always',
        triggers: [],
        version: '1.0.0',
        builtIn: true,
      }),
    )
    store.syncBuiltInsMetadata([
      tpl('plugin-author', {
        id: 'plugin-author',
        name: 'プラグイン作者',
        version: '1.2.0',
        mode: 'trigger',
        triggers: ['plugin'],
        description: 'template description',
      }),
    ])
    const after = store.get('plugin-author')
    expect(after?.body).toBe('user-edited body')
    expect(after?.name).toBe('私のプラグイン作者')
    expect(after?.description).toBe('edited')
  })

  it('skips when template version is older', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'guide',
        mode: 'trigger',
        triggers: ['どこ'],
        version: '2.0.0',
        builtIn: true,
      }),
    )
    store.syncBuiltInsMetadata([
      tpl('guide', {
        id: 'guide',
        name: 'guide',
        version: '1.0.0',
        mode: 'always',
        triggers: ['old'],
      }),
    ])
    const after = store.get('guide')
    expect(after?.mode).toBe('trigger')
    expect(after?.triggers).toEqual(['どこ'])
  })

  it('SAME version: syncs when mode drifted from template', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'guide',
        mode: 'manual',
        triggers: ['どこ'],
        version: '1.0.0',
        builtIn: true,
      }),
    )
    store.syncBuiltInsMetadata([
      tpl('guide', {
        id: 'guide',
        name: 'guide',
        version: '1.0.0',
        mode: 'trigger',
        triggers: ['どこ'],
      }),
    ])
    expect(store.get('guide')?.mode).toBe('trigger')
  })

  it('SAME version: syncs when triggers drifted (= broken-parser self-heal)', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'plugin-author',
        mode: 'trigger',
        triggers: [],
        version: '1.2.0',
        builtIn: true,
      }),
    )
    store.syncBuiltInsMetadata([
      tpl('plugin-author', {
        id: 'plugin-author',
        name: 'plugin',
        version: '1.2.0',
        mode: 'trigger',
        triggers: ['プラグイン', 'plugin', 'aiscript'],
      }),
    ])
    expect(store.get('plugin-author')?.triggers).toEqual([
      'プラグイン',
      'plugin',
      'aiscript',
    ])
  })

  it('SAME version + identical metadata: no-op (no infinite loop)', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'guide',
        mode: 'trigger',
        triggers: ['a', 'b'],
        version: '1.0.0',
        builtIn: true,
      }),
    )
    const before = store.get('guide')?.updatedAt
    store.syncBuiltInsMetadata([
      tpl('guide', {
        id: 'guide',
        name: 'guide',
        version: '1.0.0',
        mode: 'trigger',
        triggers: ['a', 'b'],
      }),
    ])
    expect(store.get('guide')?.updatedAt).toBe(before)
  })

  it('handles 1.10.0 vs 1.2.0 numerically (not lexically)', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'guide',
        mode: 'manual',
        triggers: [],
        version: '1.2.0',
        builtIn: true,
      }),
    )
    store.syncBuiltInsMetadata([
      tpl('guide', {
        id: 'guide',
        name: 'guide',
        version: '1.10.0',
        mode: 'trigger',
        triggers: ['x'],
      }),
    ])
    expect(store.get('guide')?.version).toBe('1.10.0')
  })

  it('skips skills not marked builtIn (= user-installed must not be overwritten)', () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'guide',
        mode: 'manual',
        triggers: [],
        version: '1.0.0',
        // builtIn is undefined → not a builtin, must not be touched
      }),
    )
    store.syncBuiltInsMetadata([
      tpl('guide', {
        id: 'guide',
        name: 'guide',
        version: '2.0.0',
        mode: 'trigger',
        triggers: ['x'],
      }),
    ])
    expect(store.get('guide')?.mode).toBe('manual')
    expect(store.get('guide')?.version).toBe('1.0.0')
  })

  it('skips templates whose id is not yet seeded (= seedMissingBuiltIns handles those)', () => {
    const store = useSkillsStore()
    expect(() =>
      store.syncBuiltInsMetadata([
        tpl('new-skill', {
          id: 'new-skill',
          name: 'new',
          version: '1.0.0',
          mode: 'trigger',
          triggers: ['x'],
        }),
      ]),
    ).not.toThrow()
    expect(store.get('new-skill')).toBeUndefined()
  })
})

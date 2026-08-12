// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', () => ({
  isTauri: false,
  SKILL_EXT: '.md',
  PROFILE_EXT: '.ndprofile.json5',
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

import { describe, expect, it } from 'vitest'
import type { SkillItem } from '@/services/distributableCodecs/skillCodec'
import {
  migrateLegacyAizu,
  migrateStoreMovedSkills,
  STORE_MOVED_SKILL_IDS,
} from '@/services/storeMovedSkills'

function skill(
  id: string,
  partial: Partial<SkillItem['extra']> & {
    content?: string
    store?: SkillItem['store']
  } = {},
): SkillItem {
  const { content, store, ...extra } = partial
  return {
    id,
    name: id,
    store,
    scope: { kind: 'none' },
    content: content ?? 'body',
    createdAt: 1,
    updatedAt: 1,
    extra: {
      version: '1.0.0',
      mode: 'trigger',
      triggers: [],
      builtIn: false,
      cheapCheckCapabilities: [],
      isPersona: false,
      ...extra,
    },
  }
}

describe('migrateStoreMovedSkills (#969 / #746)', () => {
  it('同梱していた skill をすべて移管対象にする (#746 で同梱ゼロにした)', () => {
    expect([...STORE_MOVED_SKILL_IDS].sort()).toEqual([
      'aiscript-author',
      'notedeck-guide',
      'notedeck-memo',
      'plugin-author',
      'self-profile',
      'skill-author',
      'theme-author',
      'theme-reference',
      'widget-author',
    ])
  })

  it('同梱をやめた built-in をストア配布版相当に変換し、変えた個体だけ返す', () => {
    const items = [
      skill('plugin-author', { builtIn: true }),
      skill('notedeck-guide', { builtIn: true }),
      skill('user-made'),
    ]
    const changed = migrateStoreMovedSkills(items, 100)
    expect(changed.map((s) => s.id)).toEqual([
      'plugin-author',
      'notedeck-guide',
    ])
    expect(items[0]).toMatchObject({
      id: 'plugin-author',
      store: { id: 'plugin-author' },
      updatedAt: 100,
      extra: { builtIn: false },
    })
    expect(items[2]?.store).toBeUndefined()
  })

  it('本文・mode・trigger などユーザーが触りうる内容は保つ', () => {
    const items = [
      skill('theme-author', {
        builtIn: true,
        content: 'ユーザーが書き換えた本文',
        mode: 'manual',
        triggers: ['自作トリガー'],
      }),
    ]
    migrateStoreMovedSkills(items, 100)
    expect(items[0]).toMatchObject({
      content: 'ユーザーが書き換えた本文',
      extra: { mode: 'manual', triggers: ['自作トリガー'] },
    })
  })

  it('builtIn でない同 id (既にストアから入れ直した) と、移管表に無い built-in は触らない', () => {
    const items = [
      skill('skill-author', { store: { id: 'skill-author' } }),
      skill('hand-written-builtin', { builtIn: true }),
    ]
    expect(migrateStoreMovedSkills(items, 100)).toEqual([])
    expect(items[1]?.extra.builtIn).toBe(true)
  })
})

describe('migrateLegacyAizu', () => {
  it('旧 built-in aizu をストア配布版相当 (manual / remote icon) に変換する', () => {
    const items = [skill('aizu', { builtIn: true, mode: 'always' })]
    expect(migrateLegacyAizu(items, 100)).toHaveLength(1)
    expect(items[0]).toMatchObject({
      store: { id: 'aizu' },
      iconUrl: 'https://store.notedeck.io/registry/skills/aizu/icon.svg',
      updatedAt: 100,
      extra: { mode: 'manual', builtIn: false },
    })
  })

  it('built-in でない aizu には触らない', () => {
    const items = [skill('aizu', { store: { id: 'aizu' } })]
    expect(migrateLegacyAizu(items, 100)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {
  planStoreMovedMigration,
  STORE_MOVED_SKILL_IDS,
} from '@/services/storeMovedSkills'
import type { SkillMeta } from '@/stores/skills'

function skill(partial: Partial<SkillMeta> & Pick<SkillMeta, 'id'>): SkillMeta {
  return {
    name: partial.id,
    version: '1.0.0',
    mode: 'trigger',
    triggers: [],
    scope: 'global',
    body: 'body',
    cheapCheckCapabilities: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('planStoreMovedMigration (#969)', () => {
  it('同梱をやめた built-in をストア配布版相当に変換する', () => {
    const before = [skill({ id: 'plugin-author', builtIn: true })]
    const { migrated, changed } = planStoreMovedMigration(before, 100)
    expect(changed).toBe(true)
    expect(migrated[0]).toMatchObject({
      id: 'plugin-author',
      builtIn: false,
      storeId: 'plugin-author',
      updatedAt: 100,
    })
  })

  it('本文・mode・trigger などユーザーが触りうる内容は保つ', () => {
    const before = [
      skill({
        id: 'theme-author',
        builtIn: true,
        body: 'ユーザーが書き換えた本文',
        mode: 'manual',
        triggers: ['自作トリガー'],
      }),
    ]
    const { migrated } = planStoreMovedMigration(before, 100)
    expect(migrated[0]).toMatchObject({
      body: 'ユーザーが書き換えた本文',
      mode: 'manual',
      triggers: ['自作トリガー'],
    })
  })

  it('builtIn でない同 id (既にストアから入れ直した) は触らない', () => {
    const before = [
      skill({ id: 'skill-author', builtIn: false, storeId: 'skill-author' }),
    ]
    const { migrated, changed } = planStoreMovedMigration(before, 100)
    expect(changed).toBe(false)
    expect(migrated[0]).toBe(before[0])
  })

  it('移行対象外の built-in は触らない', () => {
    const before = [skill({ id: 'notedeck-memo', builtIn: true })]
    const { migrated, changed } = planStoreMovedMigration(before, 100)
    expect(changed).toBe(false)
    expect(migrated[0]).toBe(before[0])
  })

  it('対象が無ければ元の配列をそのまま返す', () => {
    const before = [skill({ id: 'user-made' })]
    const { migrated, changed } = planStoreMovedMigration(before, 100)
    expect(changed).toBe(false)
    expect(migrated).toBe(before)
  })

  it('複数の対象をまとめて変換し、順序を保つ', () => {
    const before = [
      skill({ id: 'notedeck-memo', builtIn: true }),
      skill({ id: 'aiscript-author', builtIn: true }),
      skill({ id: 'theme-reference', builtIn: true }),
    ]
    const { migrated, changed } = planStoreMovedMigration(before, 100)
    expect(changed).toBe(true)
    expect(migrated.map((s) => s.id)).toEqual([
      'notedeck-memo',
      'aiscript-author',
      'theme-reference',
    ])
    expect(migrated[0]?.builtIn).toBe(true)
    expect(migrated[1]?.builtIn).toBe(false)
    expect(migrated[2]?.builtIn).toBe(false)
  })

  it('移行対象は作者系 4 本 + リファレンス 2 本', () => {
    expect([...STORE_MOVED_SKILL_IDS].sort()).toEqual([
      'aiscript-author',
      'plugin-author',
      'skill-author',
      'theme-author',
      'theme-reference',
      'widget-author',
    ])
  })
})

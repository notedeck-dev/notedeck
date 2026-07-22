import { describe, expect, it } from 'vitest'

import { planBuiltInSeed } from '@/services/builtInSeed'

interface Tpl {
  id: string
  label: string
}

const tpl = (id: string): Tpl => ({ id, label: `tpl-${id}` })
const idOf = (t: Tpl) => t.id

describe('planBuiltInSeed', () => {
  it('未知の built-in id は toAdd に入り seededIds にも記録される', () => {
    const plan = planBuiltInSeed(
      [tpl('a'), tpl('b')],
      idOf,
      new Set(),
      new Set(),
    )
    expect(plan.toAdd.map(idOf)).toEqual(['a', 'b'])
    expect(plan.seededIds.sort()).toEqual(['a', 'b'])
  })

  it('既存 id はユーザー編集を尊重して追加せず seed 済み扱いに昇格する', () => {
    const plan = planBuiltInSeed(
      [tpl('a'), tpl('b')],
      idOf,
      new Set(['a']),
      new Set(),
    )
    expect(plan.toAdd.map(idOf)).toEqual(['b'])
    expect(plan.seededIds.sort()).toEqual(['a', 'b'])
  })

  it('過去に seed 済み (= ユーザーが削除した) id は再生成しない', () => {
    const plan = planBuiltInSeed(
      [tpl('a'), tpl('b')],
      idOf,
      new Set(),
      new Set(['a']),
    )
    expect(plan.toAdd.map(idOf)).toEqual(['b'])
    expect(plan.seededIds.sort()).toEqual(['a', 'b'])
  })

  it('既存の seed 済み id は seededIds に維持される (テンプレから消えても)', () => {
    const plan = planBuiltInSeed([tpl('a')], idOf, new Set(), new Set(['gone']))
    expect(plan.toAdd.map(idOf)).toEqual(['a'])
    expect(plan.seededIds.sort()).toEqual(['a', 'gone'])
  })

  it('追加対象なしでも seen 昇格分を seededIds に反映する', () => {
    const plan = planBuiltInSeed([tpl('a')], idOf, new Set(['a']), new Set())
    expect(plan.toAdd).toEqual([])
    expect(plan.seededIds).toEqual(['a'])
  })
})

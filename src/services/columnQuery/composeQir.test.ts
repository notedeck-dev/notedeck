import { describe, expect, it } from 'vitest'

import type { QirNode, QirQuery } from '@/bindings'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { composeQir } from '@/services/columnQuery/composeQir'
import { evaluateQirQuery } from '@/services/columnQuery/evaluator'

function compile(src: string): QirQuery {
  const result = compileColumnQuery(src)
  if (!result.ok) {
    throw new Error(`compile failed: ${src}`)
  }
  return result.query
}

/** let の定義スロットと ref の参照スロットを収集する */
function collectSlots(
  node: QirNode,
  out = { defs: [] as number[], refs: [] as number[] },
): { defs: number[]; refs: number[] } {
  switch (node.kind) {
    case 'str':
    case 'num':
    case 'bool':
    case 'null':
    case 'field':
      break
    case 'ref':
      out.refs.push(node.slot)
      break
    case 'let':
      for (const b of node.bindings) {
        out.defs.push(b.slot)
        collectSlots(b.expr, out)
      }
      collectSlots(node.body, out)
      break
    case 'objIndex':
    case 'arrLen':
    case 'strMap':
      collectSlots(node.target, out)
      break
    case 'not':
      collectSlots(node.expr, out)
      break
    case 'and':
    case 'or':
    case 'cmp':
    case 'eq':
      collectSlots(node.left, out)
      collectSlots(node.right, out)
      break
    case 'strTest':
    case 'arrIncl':
      collectSlots(node.target, out)
      collectSlots(node.needle, out)
      break
  }
  return out
}

describe('composeQir', () => {
  it('空配列は null、1 個はそのまま返す', () => {
    expect(composeQir([])).toBeNull()
    const single = compile('note.text != null')
    expect(composeQir([single])).toBe(single)
  })

  it('2 パーツの合成は両条件の And になる', () => {
    const textQuery = compile('note.text != null && note.text.incl("alpha")')
    const visQuery = compile('note.visibility == "public"')
    const composed = composeQir([textQuery, visQuery])
    expect(composed).not.toBeNull()
    if (!composed) return

    const both = { text: 'alpha day', visibility: 'public' }
    const textOnly = { text: 'alpha day', visibility: 'home' }
    const visOnly = { text: 'beta', visibility: 'public' }
    const neither = { text: null, visibility: 'home' }
    expect(evaluateQirQuery(composed, both)).toBe('match')
    expect(evaluateQirQuery(composed, textOnly)).toBe('unmatch')
    expect(evaluateQirQuery(composed, visOnly)).toBe('unmatch')
    expect(evaluateQirQuery(composed, neither)).toBe('unmatch')
  })

  it('let スロットが衝突するパーツを renumber して合成する (回帰)', () => {
    // 各パーツは独立にコンパイルされスロットが 0 起点で割り当てられるため、
    // let を使うパーツ同士 (中間式の束縛も slot を消費する) は必ず衝突する。
    // renumber しない合成は「slot は式全体で一意」という QIR の契約
    // (column_query.rs QirBinding) を壊す
    const partA = compile('let t = note.text\nt != null && t.incl("alpha")')
    const partB = compile('note.cw == null\nnote.visibility == "public"')
    const slotsA = collectSlots(partA.root)
    const slotsB = collectSlots(partB.root)
    // 前提: 両パーツとも let スロットを持ち、番号が重なっている
    expect(slotsA.defs.length).toBeGreaterThan(0)
    expect(slotsB.defs.length).toBeGreaterThan(0)
    expect(slotsA.defs.some((s) => slotsB.defs.includes(s))).toBe(true)

    const composed = composeQir([partA, partB])
    expect(composed).not.toBeNull()
    if (!composed) return

    // renumber により定義スロットは合成後も全体で一意 (renumber を外すと
    // partB の let が partA と同じ番号のまま残りここで落ちる)
    const { defs, refs } = collectSlots(composed.root)
    expect(new Set(defs).size).toBe(defs.length)
    // 参照が未定義スロットを指していない (renumber は定義と参照を同時にずらす)
    const defSet = new Set(defs)
    for (const slot of refs) {
      expect(defSet.has(slot)).toBe(true)
    }

    // 合成後も各パーツの評価が And として正しい
    const cases: { note: Record<string, unknown>; expected: string }[] = [
      {
        note: { text: 'alpha!', cw: null, visibility: 'public' },
        expected: 'match',
      },
      {
        note: { text: 'beta', cw: null, visibility: 'public' },
        expected: 'unmatch',
      },
      {
        note: { text: 'alpha!', cw: null, visibility: 'home' },
        expected: 'unmatch',
      },
      {
        note: { text: null, cw: null, visibility: 'public' },
        expected: 'unmatch',
      },
    ]
    for (const c of cases) {
      expect(evaluateQirQuery(composed, c.note)).toBe(c.expected)
      // 単体評価との一致 (合成が各パーツの意味を変えていない)
      const a = evaluateQirQuery(partA, c.note)
      const b = evaluateQirQuery(partB, c.note)
      const expected =
        a === 'match' && b === 'match'
          ? 'match'
          : a === 'error' || (a === 'match' && b === 'error')
            ? 'error'
            : 'unmatch'
      expect(evaluateQirQuery(composed, c.note)).toBe(expected)
    }
  })

  it('3 パーツでもスロットは全体で一意になる', () => {
    const parts = [
      compile('let t = note.text\nt != null'),
      compile('let v = note.visibility\nv == "public"'),
      compile('let c = note.cw\nc == null'),
    ]
    const composed = composeQir(parts)
    expect(composed).not.toBeNull()
    if (!composed) return
    const { defs } = collectSlots(composed.root)
    expect(defs.length).toBe(3)
    expect(new Set(defs).size).toBe(3)
    expect(
      evaluateQirQuery(composed, { text: 'x', visibility: 'public', cw: null }),
    ).toBe('match')
    expect(
      evaluateQirQuery(composed, { text: 'x', visibility: 'public', cw: 'w' }),
    ).toBe('unmatch')
  })

  it('schemaVersion が一致しないパーツは合成できない', () => {
    const a = compile('note.text != null')
    const b = compile('note.visibility == "public"')
    expect(composeQir([a, { ...b, schemaVersion: b.schemaVersion + 1 }])).toBe(
      null,
    )
  })
})

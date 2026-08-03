import { Parser } from '@syuilo/aiscript'
import { describe, expect, it } from 'vitest'
import { collectImpureIdentifiers } from './purity'

/** フィルタソースを AST 化して純粋性検査にかける */
function check(source: string): string[] {
  const ast = new Parser().parse(source)
  return collectImpureIdentifiers(ast).map((v) => v.name)
}

describe('collectImpureIdentifiers: 純粋な参照', () => {
  it('note だけを参照する式は違反なし', () => {
    expect(check('note.text != null')).toEqual([])
  })

  it('サブセット外でも純粋なら違反なし (降格対象)', () => {
    // str.len は v1 サブセット外 (V20) だが、参照しているのは note だけ
    expect(check('note.text != null && note.text.len > 10')).toEqual([])
  })

  it('let で束縛した名前の参照は違反なし', () => {
    expect(check('let t = note.text\nt != null')).toEqual([])
  })

  it('関数の引数として束縛した名前の参照は違反なし', () => {
    expect(check('let f = @(s) { s != null }\nf(note.text)')).toEqual([])
  })

  it('each の変数束縛は違反なし', () => {
    expect(
      check('each (let f, note.files) { f.type }\nnote.text != null'),
    ).toEqual([])
  })

  it('再帰関数の自己参照は違反なし (AiScript で実際に動く)', () => {
    expect(
      check('@f(n) { if n == 0 { 0 } else { f(n - 1) } }\nf(3) == 0'),
    ).toEqual([])
  })

  it('for の変数束縛は違反なし', () => {
    expect(check('for (let i, 3) { i }\nnote.text != null')).toEqual([])
  })
})

describe('collectImpureIdentifiers: 非純粋な参照', () => {
  it('名前空間関数の呼び出しを検出する', () => {
    expect(check('Date:now() > 0')).toEqual(['Date:now'])
  })

  it('呼び出さず変数に束縛しただけでも検出する (関数第一級の素通り対策)', () => {
    // V15: allowlist は呼び出し位置ではなく全識別子参照にかける
    expect(check('let f = Date:now\nf() > 0')).toEqual(['Date:now'])
  })

  it('exists による存在検査も参照として検出する', () => {
    expect(check('exists Async:interval')).toEqual(['Async:interval'])
  })

  it('未束縛の名前への代入を検出する', () => {
    expect(check('globalThing = 1\nnote.text != null')).toContain('globalThing')
  })

  it('束縛より前の参照は検出する (前方参照は許さない)', () => {
    expect(check('let a = b\nlet b = 1\nnote.text != null')).toEqual(['b'])
  })

  it('スコープを抜けた後の参照を検出する', () => {
    expect(check('eval { let inner = 1 }\ninner == 1')).toEqual(['inner'])
  })

  it('複数の違反をすべて集める', () => {
    expect(check('Date:now() > 0 && Math:rnd() > 0')).toEqual([
      'Date:now',
      'Math:rnd',
    ])
  })
})

describe('collectImpureIdentifiers: 安全側への倒し方', () => {
  it('namespace 定義は未知の構文として違反にする', () => {
    const violations = check(':: Ns { let x = 1 }\nnote.text != null')
    expect(violations.length).toBeGreaterThan(0)
  })

  it('違反には位置情報が付く', () => {
    const ast = new Parser().parse('note.text != null && Date:now() > 0')
    const violations = collectImpureIdentifiers(ast)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.name).toBe('Date:now')
    expect(violations[0]?.line).toBe(1)
    expect(violations[0]?.column).toBeGreaterThan(1)
  })
})

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { evaluateQirQuery } from '@/services/columnQuery/evaluator'
import {
  createReferenceFilter,
  type FilterVerdict,
} from '@/services/columnQuery/referenceEvaluator'

import golden from './golden/vectors.json'

/**
 * golden vector を参照評価器 (実 AiScript 1.2.1) で検証する (#783 不変条件 (a))。
 *
 * このテストは 3 評価器一致検証の第 1 面。Phase 1 の JS QIR eval、
 * Phase 3 の Rust QIR eval が同じ vectors.json を読み、同じ期待値に
 * 一致することを検証する (Rust 側は src-tauri のテストから同ファイルを読む)。
 */

interface GoldenCase {
  name: string
  source: string
  note: unknown
  expected: FilterVerdict
}

/**
 * QIR は静的型検査を持つため、fallback では実行時 per-note エラーになる
 * 「常に型エラー」の式はそもそもコンパイルされない (V20)。
 * ここに列挙されたケースは QIR 経路では保存時拒否 = fallback 専用ベクタ。
 */
const QIR_STATIC_REJECT = new Set([
  'non-bool-result-error',
  'lt-on-string-error',
  'and-non-bool-error',
  'not-non-bool-error',
])

describe('golden vectors × 参照評価器 (AiScript 1.2.1)', () => {
  const cases = golden.cases as GoldenCase[]

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const filter = createReferenceFilter(c.source)
    try {
      expect(filter.evaluate(c.note)).toBe(c.expected)
    } finally {
      filter.dispose()
    }
  })

  it('ケース名が一意である', () => {
    const names = cases.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  describe('QIR 経路 (compiler → JS evaluator) が参照評価器と一致する', () => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
      const compiled = compileColumnQuery(c.source)
      if (QIR_STATIC_REJECT.has(c.name)) {
        expect(compiled.ok, '静的型エラーとして拒否されるべき').toBe(false)
        return
      }
      expect(
        compiled.ok,
        compiled.ok ? '' : JSON.stringify(compiled.diagnostics),
      ).toBe(true)
      if (!compiled.ok) return
      expect(evaluateQirQuery(compiled.query, c.note)).toBe(c.expected)
    })
  })

  it('構文エラーのソースは保存時エラー (per-note エラーと区別)', () => {
    expect(() => createReferenceFilter('note.text !=')).toThrow()
  })

  it('lone surrogate は JS 経路では評価可能 (V24 既知乖離、共有ベクタ対象外)', () => {
    // serde_json が lone surrogate を表現できないため vectors.json に含めない。
    // Rust 経路では行エラー = per-note エラー扱いになることが仕様。
    const filter = createReferenceFilter(
      'note.text != null && note.text.incl("a")',
    )
    try {
      expect(filter.evaluate({ text: 'a\uD800b' })).toBe('match')
    } finally {
      filter.dispose()
    }
  })

  it('同一フィルタで評価を繰り返しても結果が汚染されない', () => {
    // jsToVal をノートごとに変換している限り、前のノートの評価が
    // 次のノートに影響しない (V23 の相互汚染防止の最小確認)
    const filter = createReferenceFilter(
      'note.text != null && note.text.incl("x")',
    )
    try {
      expect(filter.evaluate({ text: 'x' })).toBe('match')
      expect(filter.evaluate({ text: 'y' })).toBe('unmatch')
      expect(filter.evaluate({ text: null })).toBe('unmatch')
      expect(filter.evaluate({ text: 'x' })).toBe('match')
    } finally {
      filter.dispose()
    }
  })
})

/**
 * Rust QIR eval (Phase 3) 用の QIR スナップショット。
 *
 * Rust 側には AiScript コンパイラが無いため、golden vector のソースを
 * そのままでは評価できない。コンパイル済み QIR を生成物として共有し、
 * src-tauri のテストがこれを読んで同じ期待値に一致するか検証する
 * (不変条件 (a) の 3 評価器一致検証のうち Rust 面)。
 *
 * ずれたら `pnpm gen:golden-qir` で再生成してコミットする。
 * bindings.ts / openapi.json のスナップショットと同じ運用。
 */
describe('QIR スナップショット (Rust 評価器との共有)', () => {
  const SNAPSHOT_PATH = join(
    import.meta.dirname,
    'golden',
    'qir.generated.json',
  )

  function build(): unknown {
    const compiledCases: Record<string, unknown> = {}
    for (const c of golden.cases as GoldenCase[]) {
      if (QIR_STATIC_REJECT.has(c.name)) continue
      const compiled = compileColumnQuery(c.source)
      if (!compiled.ok) throw new Error(`compile failed: ${c.name}`)
      compiledCases[c.name] = compiled.query
    }
    return {
      note: 'Generated from vectors.json by `pnpm gen:golden-qir`. Do not edit by hand.',
      cases: compiledCases,
    }
  }

  it('コンパイラ出力と一致する', () => {
    const built = build()
    if (process.env.UPDATE_GOLDEN_QIR === '1') {
      writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(built, null, 2)}\n`)
      return
    }
    const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
    expect(
      committed,
      'QIR スナップショットが古いです。`pnpm gen:golden-qir` を実行してください',
    ).toEqual(built)
  })
})

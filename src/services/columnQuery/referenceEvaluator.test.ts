import { describe, expect, it } from 'vitest'
import { createReferenceFilter } from './referenceEvaluator'

/**
 * 名前付きクエリ形 `@(note) { ... }` の受理 (#783 レビュー修正 1)。
 * ⚡ コンパイラ (compileTopLevel) は単一 fn 式なら本体を取り出すのに、
 * 🐢 降格経路が無条件ラップで fail-closed になる食い違いの回帰テスト。
 */
describe('createReferenceFilter: 名前付きクエリ形 (fn 式)', () => {
  it('@(n) { ... } 形式を match/unmatch で評価できる', () => {
    const filter = createReferenceFilter('@(n) { n.text != null }')
    try {
      expect(filter.evaluate({ text: 'hello' })).toBe('match')
      expect(filter.evaluate({ text: null })).toBe('unmatch')
    } finally {
      filter.dispose()
    }
  })

  it('引数名が note でなくても位置渡しで評価される', () => {
    const filter = createReferenceFilter('@(x) { x.visibility == "public" }')
    try {
      expect(filter.evaluate({ visibility: 'public' })).toBe('match')
      expect(filter.evaluate({ visibility: 'home' })).toBe('unmatch')
    } finally {
      filter.dispose()
    }
  })

  it('引数が 1 個でない fn は error verdict になる (fail-closed)', () => {
    const filter = createReferenceFilter('@(a, b) { true }')
    try {
      // 従来ラップに落ち、本体が fn 値 = 非 bool → 全ノート error
      expect(filter.evaluate({ text: 'hello' })).toBe('error')
    } finally {
      filter.dispose()
    }
  })
})

describe('createReferenceFilter: 裸の式形 (回帰)', () => {
  it('従来の式形は引き続き評価できる', () => {
    const filter = createReferenceFilter(
      'note.text != null && note.text.incl("misskey")',
    )
    try {
      expect(filter.evaluate({ text: 'misskey 最高' })).toBe('match')
      expect(filter.evaluate({ text: 'hello' })).toBe('unmatch')
      expect(filter.evaluate({ text: null })).toBe('unmatch')
    } finally {
      filter.dispose()
    }
  })

  it('let 列 + 末尾式の形も評価できる', () => {
    const filter = createReferenceFilter(
      'let t = note.text\nt != null && t.incl("x")',
    )
    try {
      expect(filter.evaluate({ text: 'x' })).toBe('match')
      expect(filter.evaluate({ text: 'y' })).toBe('unmatch')
    } finally {
      filter.dispose()
    }
  })
})

import { Interpreter, Parser, utils, type values } from '@syuilo/aiscript'
import { describe, expect, it } from 'vitest'

import { createReferenceFilter } from '@/services/columnQuery/referenceEvaluator'

/**
 * step 予算の実行規律 (#783 V23) の担保テスト。
 *
 * 前提事実 (このテストが pin する @syuilo/aiscript 1.2.1 の内部依存):
 *   - Interpreter.stepCount は public フィールドで、自動 reset されない
 *     (インスタンス生涯累積)。per-note reset は代入で実現する (#733 と同型)
 *   - maxStep 超過は execFnSync から同期 throw される (犯人特定が可能)
 *
 * pin 更新でこの前提が崩れたらここが落ち、対策方式の再検討を強制する
 * (不変条件 (d) の「内部依存はバージョン更新テストで担保」)。
 *
 * 【スパイクで発見した既知の罠 — テスト不能なので記録のみ】
 * 空ボディの `loop { }` は step を 1 つも消費せず、maxStep では停止しない
 * (同期実行のまま無限にスピンし、メインスレッドなら UI が完全凍結する)。
 * step は「文の評価」単位で数えられ、空ボディはループ 1 周あたり 0 文のため。
 * ⇒ maxStep はメモリ (V15: arr.repeat) に加えて CPU すら完全には縛れない。
 *   Worker 隔離 + 判定タイムアウト + terminate (V22/V23) が唯一の確実な防御
 *   であることの追加根拠。fallback 評価は必ず Worker 側で行うこと。
 *   (このケースを直接テストするとスイートがハングするため再現コードは置かない)
 */

function buildRawFilter(source: string, maxStep: number) {
  const parser = new Parser()
  const ast = parser.parse(`let __filter = @(note) {\n${source}\n}`)
  const interpreter = new Interpreter({}, { maxStep })
  interpreter.execSync(ast)
  const fn = interpreter.scope.get('__filter') as values.VFn
  return { interpreter, fn }
}

describe('step 予算 (#783 V23)', () => {
  it('stepCount は自動 reset されず累積する (内部依存の pin)', () => {
    const { interpreter, fn } = buildRawFilter(
      'note.text != null && note.text.incl("x")',
      500,
    )
    // reset せずに呼び続けると、1 回では収まる評価でも累積で必ず超過する
    expect(() => {
      for (let i = 0; i < 500; i++) {
        interpreter.execFnSync(fn, [utils.jsToVal({ text: 'xxx' })])
      }
    }).toThrow()
    expect(interpreter.stepCount).toBeGreaterThanOrEqual(500)
  })

  it('per-note の stepCount reset 代入で予算が評価単位になる', () => {
    const { interpreter, fn } = buildRawFilter(
      'note.text != null && note.text.incl("x")',
      500,
    )
    // 同じ 500 回でも、評価前に reset すれば一度も超過しない
    for (let i = 0; i < 500; i++) {
      interpreter.stepCount = 0
      const result = interpreter.execFnSync(fn, [
        utils.jsToVal({ text: 'xxx' }),
      ])
      expect(result.type).toBe('bool')
    }
  })

  it('referenceEvaluator は reset 込みなので連続評価が安定する', () => {
    const filter = createReferenceFilter(
      'note.text != null && note.text.incl("x")',
    )
    try {
      for (let i = 0; i < 500; i++) {
        expect(filter.evaluate({ text: 'xxx' })).toBe('match')
      }
    } finally {
      filter.dispose()
    }
  })

  it('無限ループ (文あり) は maxStep で同期停止し per-note エラーになる', () => {
    const filter = createReferenceFilter('loop { let x = 1 }\ntrue')
    try {
      expect(filter.evaluate({ text: 'x' })).toBe('error')
    } finally {
      filter.dispose()
    }
  })

  it('maxStep 超過後も同一インスタンスで次のノートを評価できる (abort 汚染なし)', () => {
    // err callback なし構成では raw throw のみで abort() が呼ばれないため、
    // 暴走ノートの次のノートから正常に復帰できる (V23 の構成根拠)
    const filter = createReferenceFilter(
      'if note.text == null { loop { let x = 1 } }\ntrue',
    )
    try {
      expect(filter.evaluate({ text: null })).toBe('error')
      expect(filter.evaluate({ text: 'ok' })).toBe('match')
    } finally {
      filter.dispose()
    }
  })
})

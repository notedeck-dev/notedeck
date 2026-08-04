import { Interpreter, Parser, utils, type values } from '@syuilo/aiscript'

/**
 * カラムクエリの参照評価器 (#783)。
 *
 * AiScript 1.2.1 の Interpreter でフィルタ式を per-note 評価する。
 * QIR の意味論は「AiScript 1.2.1 と同一」と定義されている (不変条件 (a)) ため、
 * この評価器の出力が golden vector の期待値の正本になる。
 * Phase 2 の Worker fallback 評価器はこの実装を核にする。
 *
 * 評価結果の 3 値 (V14/V24):
 *   - match:   式が true を返した
 *   - unmatch: 式が false を返した
 *   - error:   評価エラー (型エラー・null レシーバ・非 bool 結果など)
 *              = per-note エラー。ノートは除外し診断に計上する
 */

export type FilterVerdict = 'match' | 'unmatch' | 'error'

/** フィルタ文脈専用の step 予算 (プラグインの 100,000 とは別、仕様追補 D)。 */
export const FILTER_MAX_STEP = 5000

export interface ReferenceFilter {
  evaluate(note: unknown): FilterVerdict
  dispose(): void
}

/**
 * フィルタソース (式 or let 列 + 末尾式 or 関数定義 + 末尾式) から
 * per-note 評価関数を作る。ソースがパース不能・実行不能ならここで throw する
 * (保存時エラーに相当。per-note エラーとは区別される)。
 *
 * V23 の実行規律:
 *   - err callback なし + abortOnError なし → execFnSync は raw throw し、
 *     abort() によるインスタンス汚染が起きない
 *   - 各ノート評価前に stepCount を 0 に戻す (累積カウンタ対策、#733 と同型)
 *   - jsToVal の再利用はしない (同一フィルタ内でもノートごとに変換する。
 *     Obj:set による前ノート値の破壊がベクタ間に波及しないように)
 */
export function createReferenceFilter(source: string): ReferenceFilter {
  // 名前付きクエリ形 `@(note) { ... }` (単一の 1 引数 fn 式) は、そのまま
  // ラップすると本体が「fn 値を返す式」になり全ノート error になる。
  // ⚡ コンパイラ (compileTopLevel) と表層構文の受理を揃え、fn 式自体を
  // フィルタ関数として束縛する (#783 レビュー修正 1)。execFnSync は位置渡し
  // なので引数名は問わない。引数が 1 個でない fn は従来ラップに落とす
  // (本体が fn 値 = 非 bool で実行時 error verdict、fail-closed で安全側)
  let isSingleUnaryFn = false
  try {
    const probe = new Parser().parse(source)
    const only = probe[0]
    isSingleUnaryFn =
      probe.length === 1 && only?.type === 'fn' && only.params.length === 1
  } catch {
    // parse 不能はラップ後の parse で保存時エラーとして throw させる
  }
  const wrapped = isSingleUnaryFn
    ? `let __filter = ${source}`
    : `let __filter = @(note) {\n${source}\n}`
  const parser = new Parser()
  const ast = parser.parse(wrapped)

  const interpreter = new Interpreter({}, { maxStep: FILTER_MAX_STEP })
  interpreter.execSync(ast)
  const fn = interpreter.scope.get('__filter') as values.VFn

  return {
    evaluate(note: unknown): FilterVerdict {
      interpreter.stepCount = 0
      let result: values.Value
      try {
        result = interpreter.execFnSync(fn, [utils.jsToVal(note)])
      } catch {
        return 'error'
      }
      if (result.type !== 'bool') return 'error'
      return result.value ? 'match' : 'unmatch'
    },
    dispose(): void {
      interpreter.abort()
    },
  }
}

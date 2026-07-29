import { type Ast, Parser } from '@syuilo/aiscript'
import { describe, expect, it } from 'vitest'

/**
 * QIR コンパイラの AST 表面契約 (#783 不変条件 (d): silent miscompile 禁止)。
 *
 * 2 段構えで「未知ノードは必ずコンパイル不能に落ちる」を担保する:
 *
 * 1. 型レベル: NODE_DISPOSITION が `Ast.Node['type']` の全メンバーを持つことを
 *    `satisfies` で強制する。@syuilo/aiscript の pin 更新でノード種別が増えると
 *    ここが型エラーになり、新ノードの扱いを決めるまでビルドが通らない。
 * 2. 実行時: Parser の実出力を構造的に走査して現れた type 文字列を収集し、
 *    全てが NODE_DISPOSITION のキーに含まれることを検証する。dts と実装の
 *    乖離 (型定義に無いノードを実行時に吐くケース) を検出する。
 *
 * disposition の値は Phase 1 のコンパイラ実装で確定する暫定分類であり、
 * このテストの主目的は「全ノード種別が明示的に分類されていること」の担保。
 *   - compile: コンパイラがハンドラを持つ (個別条件で降格しうる)
 *   - degrade: 常にコンパイル不能 = fallback 逐次適用へ明示降格
 */

type AstNodeType = Ast.Node['type']
type Disposition = 'compile' | 'degrade'

// Phase 1 でコンパイラ本体のモジュールへ移す (テスト内に置くのはスパイク段階のみ)
const NODE_DISPOSITION = {
  // --- トップレベル構造 ---
  ns: 'degrade',
  meta: 'degrade',
  attr: 'degrade',

  // --- 文 ---
  def: 'compile', // let (QIR Let ノード)。mut (var) は個別条件で降格
  return: 'degrade', // 関数本体は Let 列 + 末尾式のみ許可 (V19)
  each: 'degrade',
  for: 'degrade',
  loop: 'degrade',
  break: 'degrade',
  continue: 'degrade',
  assign: 'degrade',
  addAssign: 'degrade',
  subAssign: 'degrade',

  // --- 式 ---
  if: 'degrade',
  fn: 'compile', // 再帰しない純粋関数のみ Let 列に脱糖 (V19)
  match: 'degrade',
  block: 'degrade',
  exists: 'degrade',
  tmpl: 'degrade',
  str: 'compile',
  num: 'compile',
  bool: 'compile',
  null: 'compile',
  obj: 'degrade', // TODO(Phase 1): 定数 obj リテラルを許可するか判断
  arr: 'degrade', // TODO(Phase 1): ["a","b"].incl(x) イディオムの定数 arr を判断
  plus: 'degrade', // 負数/正数リテラルは parser が num に畳むため、これらは式オペランドにのみ現れる
  minus: 'degrade',
  not: 'compile',
  pow: 'degrade',
  mul: 'degrade',
  div: 'degrade',
  rem: 'degrade',
  add: 'degrade',
  sub: 'degrade',
  lt: 'compile',
  lteq: 'compile',
  gt: 'compile',
  gteq: 'compile',
  eq: 'compile',
  neq: 'compile',
  and: 'compile',
  or: 'compile',
  identifier: 'compile', // allowlist 検査は識別子単位で別途 (V15)
  call: 'compile', // 演算 allowlist に載る呼び出しのみ。他は降格
  index: 'compile', // obj への文字列リテラル index のみ。配列 index は降格
  prop: 'compile', // フィールド allowlist + .len のみ

  // --- 型注釈 ---
  namedTypeSource: 'degrade', // TODO(Phase 1): 注釈を無視して compile 扱いにするか判断
  fnTypeSource: 'degrade',
  unionTypeSource: 'degrade',
} as const satisfies Record<AstNodeType, Disposition>

/**
 * Parser の実出力に現れる type 文字列を、子ノードの形状を仮定せずに
 * 構造走査で全部集める。「子を持つ未知ノードの子を見落とす」事故を
 * ノード形状に依存しないことで回避する。
 */
function collectNodeTypes(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectNodeTypes(v, out)
    return
  }
  if (value instanceof Map) {
    for (const v of value.values()) collectNodeTypes(v, out)
    return
  }
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (typeof rec.type === 'string' && rec.loc !== undefined) {
      out.add(rec.type)
    }
    for (const [key, v] of Object.entries(rec)) {
      if (key === 'loc') continue
      collectNodeTypes(v, out)
    }
  }
}

/** 全ノード種別を生成することを意図した構文コーパス。 */
const SYNTAX_CORPUS: string[] = [
  ':: Ns { let inNs = 1 }',
  '### { name: "meta" }',
  '#[attrName]\nlet withAttr = 1',
  '@f() { return 1 }',
  'each let v, [1] { v }',
  'for let i, 3 { i }',
  'loop { break }',
  'loop { continue }',
  'var m = 1\nm = 2\nm += 1\nm -= 1',
  'if true { 1 } elif false { 2 } else { 3 }',
  'match 1 { case 1 => 1, default => 0 }',
  'eval { 1 }',
  'let e = 1\nexists e',
  'let t = `a{1}b`',
  'let lits = ["s", 1, true, null, { a: 1 }, [1]]',
  'let n = 1\nlet unary = [+n, -n, !true]',
  'let arith = [1 ^ 2, 1 * 2, 1 / 2, 1 % 2, 1 + 2, 1 - 2]',
  'let cmp = [1 < 2, 1 <= 2, 1 > 2, 1 >= 2, 1 == 2, 1 != 2]',
  'let logic = [true && false, true || false]',
  'let id = 1\nlet uses = [id, Math:abs(-1), [1][0], "s".len]',
  'let typed: str = "a"',
  'let fnTyped: @(num) => num = @(n) { n }',
  'let unionTyped: num | str = 1',
]

describe('QIR AST surface (#783 不変条件 (d))', () => {
  it('Parser が出力する全ノード種別が disposition 表に分類されている', () => {
    const parser = new Parser()
    const seen = new Set<string>()
    for (const src of SYNTAX_CORPUS) {
      collectNodeTypes(parser.parse(src), seen)
    }
    const known = new Set(Object.keys(NODE_DISPOSITION))
    const unknown = [...seen].filter((t) => !known.has(t))
    expect(unknown, '実行時に dts 外のノード種別が現れた').toEqual([])
  })

  it('コーパスが disposition 表の全ノード種別を実際に生成する', () => {
    const parser = new Parser()
    const seen = new Set<string>()
    for (const src of SYNTAX_CORPUS) {
      collectNodeTypes(parser.parse(src), seen)
    }
    const missing = Object.keys(NODE_DISPOSITION).filter((t) => !seen.has(t))
    expect(missing, 'コーパスで生成できないノード種別がある').toEqual([])
  })
})

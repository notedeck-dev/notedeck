import type { Ast } from '@syuilo/aiscript'

/**
 * カラムクエリの純粋性検査 (#783 Phase 2 / V15)。
 *
 * QIR にコンパイルできない式は Worker で AiScript Interpreter に逐次適用する
 * (🐢 降格) が、そこへ流してよいのは「サブセット外だが純粋」な式だけである。
 * 副作用・非決定 API に到達しうる式は降格させず保存時に拒否する (不変条件 (c))。
 *
 * 判定は **全識別子参照** の allowlist で行う。呼び出し位置だけを見ると
 * `let f = Date:now` のように第一級の関数値として束縛してから呼ぶ経路で
 * 素通りするため。名前空間参照 (`Async:interval`) はコロン込みの単一識別子
 * として現れるので、identifier を漏れなく拾えば同じ網にかかる。
 *
 * Worker 隔離・step 予算は「暴走を止める」ための層であって、到達可能性を
 * 絞るのはこの検査の役目。両方揃って初めて (c) を満たす。
 */

/** フィルタ文脈で参照してよい自由識別子。ローカル束縛はこれとは別に許可される */
export const FILTER_FREE_IDENTIFIERS: ReadonlySet<string> = new Set(['note'])

export interface PurityViolation {
  /** 違反した識別子名。未知構文の場合は `(構文: <type>)` 形式 */
  name: string
  line?: number
  column?: number
}

/**
 * AST を歩いて allowlist 外の自由識別子を集める。
 * 空配列なら「純粋」= 🐢 降格の対象にしてよい。
 *
 * 未知のノード種別は違反として扱う (安全側に倒す)。コンパイラが未知ノードを
 * 必ずコンパイル不能に落とす (不変条件 (d)) のと同じ理由で、知らない構文を
 * 素通りさせない。
 */
export function collectImpureIdentifiers(
  ast: readonly Ast.Node[],
): PurityViolation[] {
  const violations: PurityViolation[] = []
  // スコープチェーン。末尾が最も内側
  const scopes: Set<string>[] = [new Set()]

  const bound = (name: string): boolean =>
    FILTER_FREE_IDENTIFIERS.has(name) || scopes.some((s) => s.has(name))

  const declare = (name: string): void => {
    scopes[scopes.length - 1]?.add(name)
  }

  const violate = (name: string, loc: Ast.Loc | undefined): void => {
    violations.push({
      name,
      line: loc?.start.line,
      column: loc?.start.column,
    })
  }

  const reference = (name: string, loc: Ast.Loc | undefined): void => {
    if (!bound(name)) violate(name, loc)
  }

  /** 束縛パターン (identifier / 分割代入) から名前を宣言する */
  const declarePattern = (dest: Ast.Expression): void => {
    switch (dest.type) {
      case 'identifier':
        declare(dest.name)
        return
      case 'arr':
        for (const el of dest.value) declarePattern(el)
        return
      case 'obj':
        for (const el of dest.value.values()) declarePattern(el)
        return
      default:
        // 未知の束縛形。左辺を式として歩いて参照漏れを防ぐ
        walk(dest)
    }
  }

  const walkAll = (nodes: readonly (Ast.Node | undefined)[]): void => {
    for (const n of nodes) if (n) walk(n)
  }

  /** 新しいスコープで本体を歩く */
  const scoped = (fn: () => void): void => {
    scopes.push(new Set())
    fn()
    scopes.pop()
  }

  function walk(node: Ast.Node): void {
    switch (node.type) {
      // --- 参照・束縛 ---
      case 'identifier':
        reference(node.name, node.loc)
        return
      case 'exists':
        // 存在検査も参照として扱う (未定義でもエラーにならないが素通りさせない)
        reference(node.identifier.name, node.identifier.loc)
        return
      case 'def':
        if (node.expr.type === 'fn') {
          // 関数定義は自己名を参照できる (再帰が実際に動く)。先に宣言する
          declarePattern(node.dest)
          walk(node.expr)
          return
        }
        // 関数以外の右辺は宣言前のスコープで評価される (前方参照はエラー)
        walk(node.expr)
        declarePattern(node.dest)
        return
      case 'assign':
      case 'addAssign':
      case 'subAssign':
        // 代入先は既存束縛でなければならない。未束縛なら違反
        walk(node.dest)
        walk(node.expr)
        return

      // --- スコープを作るもの ---
      case 'fn':
        scoped(() => {
          for (const p of node.params) {
            if (p.default) walk(p.default)
            declarePattern(p.dest)
          }
          walkAll(node.children)
        })
        return
      case 'block':
      case 'loop':
        scoped(() => walkAll(node.statements))
        return
      case 'each':
        walk(node.items)
        scoped(() => {
          declarePattern(node.var)
          walk(node.for)
        })
        return
      case 'for':
        walkAll([node.from, node.to, node.times])
        scoped(() => {
          if (node.var !== undefined) declare(node.var)
          walk(node.for)
        })
        return

      // --- 制御構文 ---
      case 'if':
        walk(node.cond)
        walk(node.then)
        for (const ei of node.elseif) {
          walk(ei.cond)
          walk(ei.then)
        }
        if (node.else) walk(node.else)
        return
      case 'match':
        walk(node.about)
        for (const q of node.qs) {
          walk(q.q)
          walk(q.a)
        }
        if (node.default) walk(node.default)
        return
      case 'return':
        walk(node.expr)
        return
      case 'break':
        if (node.expr) walk(node.expr)
        return
      case 'continue':
        return

      // --- 複合式 ---
      case 'call':
        walk(node.target)
        walkAll(node.args)
        return
      case 'index':
        walk(node.target)
        walk(node.index)
        return
      case 'prop':
        // name はプロパティ名であって識別子参照ではない
        walk(node.target)
        return
      case 'tmpl':
        walkAll(node.tmpl)
        return
      case 'obj':
        walkAll([...node.value.values()])
        return
      case 'arr':
        walkAll(node.value)
        return

      // --- 単項 ---
      case 'plus':
      case 'minus':
      case 'not':
        walk(node.expr)
        return

      // --- 二項 ---
      case 'pow':
      case 'mul':
      case 'div':
      case 'rem':
      case 'add':
      case 'sub':
      case 'lt':
      case 'lteq':
      case 'gt':
      case 'gteq':
      case 'eq':
      case 'neq':
      case 'and':
      case 'or':
        walk(node.left)
        walk(node.right)
        return

      // --- リテラル ---
      case 'str':
      case 'num':
      case 'bool':
      case 'null':
        return

      // --- 未知・サブセット外の構文は安全側 (違反) に倒す ---
      default:
        violate(`(構文: ${(node as Ast.Node).type})`, (node as Ast.Node).loc)
    }
  }

  walkAll(ast)
  return violations
}

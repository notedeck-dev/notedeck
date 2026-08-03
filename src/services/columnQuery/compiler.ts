import { type Ast, Parser } from '@syuilo/aiscript'

import type { QirBinding, QirNode, QirQuery } from '@/bindings'
import { collectImpureIdentifiers } from '@/services/columnQuery/purity'

/**
 * カラムクエリコンパイラ: AiScript 1.2.1 AST → QIR (#783)。
 *
 * v1 サブセット (issue #783 本文) のみを受理し、外れる構文は理由付き診断で
 * 「コンパイル不能」に落とす (不変条件 (d): silent miscompile 禁止)。
 * Phase 2 で「純粋なサブセット外」は Worker fallback へ降格するが、
 * Phase 1 ではコンパイル不能 = 保存不可として扱う。
 *
 * 意味論の保存 (V19):
 * - let は eager 評価 (テキスト置換インライン禁止) → QIR Let ノード
 * - 関数は全引数 eager 評価 (call-by-value) + 本体を Let 列に脱糖
 * - 再帰 (相互再帰含む) は脱糖が停止しないためコンパイル不能
 * - 脱糖中もノード数上限を適用 (指数爆発でコンパイラ自体が先に死なないように)
 */

// QIR 上限 (Rust 側 src-tauri/src/commands/column_query.rs と同値を維持)
export const QIR_SCHEMA_VERSION = 1
export const QIR_MAX_NODES = 2000
export const QIR_MAX_DEPTH = 256

export interface QueryDiagnostic {
  message: string
  line?: number
  column?: number
}

/**
 * null になりうるフィールドを guard なしで操作している警告 (V25)。
 *
 * `note.text.incl("x")` は text=null のノート (画像のみ・純リノート) で
 * per-note エラーになり、そのノートが丸ごと除外される。書いた本人からは
 * 「リノートが全部消えるフィルタ」に見えるので、保存前に気づかせる。
 */
export interface QueryWarning extends QueryDiagnostic {
  /** 対象フィールド (例: `note.text`) */
  field: string
  /** 挿入すべきガード式 (例: `note.text != null`) */
  guard: string
}

export type CompileResult =
  | {
      ok: true
      query: QirQuery
      nodeCount: number
      warnings: QueryWarning[]
    }
  | {
      ok: false
      /**
       * サブセット外だが純粋なので Worker で逐次適用できる (🐢 降格, Phase 2)。
       * false は「副作用・非決定 API に到達しうる」か「そもそも式として
       * 成立していない」ことを意味し、保存時に拒否する (不変条件 (c))。
       */
      degradable: boolean
      diagnostics: QueryDiagnostic[]
    }

// --- 静的型 (成功時型)。エラーになりうる null 可能性も集合に含める ---

const T_STR = 1
const T_NUM = 2
const T_BOOL = 4
const T_NULL = 8
const T_ARR = 16
const T_OBJ = 32
const T_SCALAR = T_STR | T_NUM | T_BOOL

type TypeMask = number

/**
 * note フィールド allowlist (パス → 成功時型)。
 * NormalizedNote の serde 形 (camelCase) に対して定義する (不変条件 (g)/(h))。
 */
const NOTE_FIELD_TYPES: Record<string, TypeMask> = {
  text: T_STR | T_NULL,
  cw: T_STR | T_NULL,
  visibility: T_STR,
  localOnly: T_BOOL | T_NULL,
  renoteId: T_STR | T_NULL,
  replyId: T_STR | T_NULL,
  files: T_ARR | T_NULL,
  reactions: T_OBJ | T_NULL,
  user: T_OBJ,
  'user.username': T_STR,
  'user.host': T_STR | T_NULL,
  'user.name': T_STR | T_NULL,
}

/** reactions のようにリテラル index を許すフィールドの値型。 */
const NOTE_INDEXABLE_VALUE_TYPES: Record<string, TypeMask> = {
  reactions: T_NUM | T_NULL,
}

class CompileFail extends Error {
  diagnostic: QueryDiagnostic
  constructor(message: string, loc?: Ast.Loc) {
    super(message)
    this.diagnostic = {
      message,
      line: loc?.start.line,
      column: loc?.start.column,
    }
  }
}

interface FnEntry {
  kind: 'fn'
  node: Ast.Fn
  /** 定義位置のレキシカルスコープ (クロージャ捕捉)。 */
  scope: Scope
  name: string
}

type ScopeEntry =
  | { kind: 'note' }
  | { kind: 'slot'; slot: number; type: TypeMask }
  | FnEntry

type Scope = Map<string, ScopeEntry>

interface Typed {
  qir: QirNode
  type: TypeMask
  /** 式が note のフィールドパスそのものであるとき、そのパス。 */
  notePath?: string[]
}

class Compiler {
  private nodeCount = 0
  private nextSlot = 0
  /**
   * `X != null &&` の右辺を評価している間だけ X を non-null 扱いにする (V25)。
   * and の右辺コンパイル中だけ積まれるので、or をまたいだ先には効かない。
   */
  private guardedPaths = new Set<string>()
  /**
   * note ルートの識別子名。`@(n) { ... }` 形式では `n` になる。
   * ガード検出はソース上の名前で行うので、警告キーも同じ名前で作らないと
   * 「ガードしてあるのに警告が出る」ことになる。
   */
  private noteRootName = 'note'
  /** unguarded な nullable 操作。フィールドごとに最初の 1 件だけ残す */
  private warnings = new Map<string, QueryWarning>()
  private inlineStack: Ast.Fn[] = []

  /** QIR ノードを 1 つ数える。脱糖の指数爆発をここで止める (V19)。 */
  private emit<N extends QirNode>(node: N): N {
    this.nodeCount += 1
    if (this.nodeCount > QIR_MAX_NODES) {
      throw new CompileFail(
        `式が大きすぎます (関数展開後 ${QIR_MAX_NODES} ノード超)`,
      )
    }
    return node
  }

  compile(source: string): CompileResult {
    let statements: Ast.Node[]
    try {
      statements = new Parser().parse(source)
    } catch (e) {
      // パースできない = AST が無いので Worker にも渡せない
      return {
        ok: false,
        degradable: false,
        diagnostics: [{ message: `構文エラー: ${String(e)}` }],
      }
    }
    try {
      const root = this.compileTopLevel(statements)
      const depth = qirDepth(root)
      if (depth > QIR_MAX_DEPTH) {
        throw new CompileFail(`式が深すぎます (深さ ${QIR_MAX_DEPTH} 超)`)
      }
      return {
        ok: true,
        query: { schemaVersion: QIR_SCHEMA_VERSION, root },
        nodeCount: this.nodeCount,
        warnings: [...this.warnings.values()],
      }
    } catch (e) {
      if (e instanceof CompileFail) {
        return this.failure(statements, e.diagnostic)
      }
      throw e
    }
  }

  /**
   * コンパイル不能を「🐢 降格できる」と「保存時に拒否する」に振り分ける
   * (Phase 2 / V15)。降格先の Worker は AiScript Interpreter をそのまま
   * 動かすので、サブセット境界ではなく到達可能性で判断する。
   */
  private failure(
    statements: Ast.Node[],
    diagnostic: QueryDiagnostic,
  ): CompileResult {
    // 空ソースは降格しても評価する式が無い
    if (statements.length === 0) {
      return { ok: false, degradable: false, diagnostics: [diagnostic] }
    }
    const impure = collectImpureIdentifiers(statements)
    if (impure.length === 0) {
      return { ok: false, degradable: true, diagnostics: [diagnostic] }
    }
    return {
      ok: false,
      degradable: false,
      diagnostics: [
        diagnostic,
        ...impure.map((v) => ({
          message: `${v.name} はフィルタから参照できません`,
          line: v.line,
          column: v.column,
        })),
      ],
    }
  }

  private compileTopLevel(statements: Ast.Node[]): QirNode {
    const only = statements[0]
    if (only === undefined) {
      throw new CompileFail('フィルタ式が空です')
    }
    // 名前付きクエリ形 `@(note) { ... }`: 単一の fn 式なら本体をフィルタとして扱う
    if (statements.length === 1 && only.type === 'fn') {
      const fn = only
      const param = fn.params[0]
      if (fn.params.length !== 1 || param === undefined) {
        throw new CompileFail(
          'フィルタ関数の引数は (note) の 1 つだけです',
          fn.loc,
        )
      }
      const paramName = identifierName(param.dest, fn.loc)
      // 警告・ガード検出はソース上の名前で行う (V25)
      this.noteRootName = paramName
      const scope: Scope = new Map([[paramName, { kind: 'note' as const }]])
      return this.compileBody(fn.children, scope, fn.loc)
    }
    const scope: Scope = new Map([['note', { kind: 'note' as const }]])
    return this.compileBody(statements, scope, only.loc)
  }

  /**
   * 文列 (let/関数定義/中間式) + 末尾式を Let ノードへ。
   * 中間式も eager 評価しエラー伝播させる (AiScript と同じ観測可能性)。
   */
  private compileBody(
    children: (Ast.Statement | Ast.Expression | Ast.Node)[],
    scope: Scope,
    loc: Ast.Loc,
  ): QirNode {
    if (children.length === 0) {
      throw new CompileFail('本体が空です', loc)
    }
    const bindings: QirBinding[] = []
    const localScope: Scope = new Map(scope)
    for (const [i, stmt] of children.entries()) {
      const isLast = i === children.length - 1
      if (stmt.type === 'def') {
        if (isLast) {
          throw new CompileFail('末尾は式である必要があります', stmt.loc)
        }
        this.compileDef(stmt, localScope, bindings)
        continue
      }
      if (!isAstExpression(stmt)) {
        throw new CompileFail(`サブセット外の構文です: ${stmt.type}`, stmt.loc)
      }
      const typed = this.compileExpr(stmt, localScope)
      if (isLast) {
        // トップレベル/本体の結果型は静的に bool (null は per-note エラー側)
        if ((typed.type & ~T_NULL) !== T_BOOL) {
          throw new CompileFail(
            '式の結果は bool である必要があります (true = 表示)',
            stmt.loc,
          )
        }
        if (bindings.length === 0) return typed.qir
        return this.emit({ kind: 'let', bindings, body: typed.qir })
      }
      // 中間式: 値は捨てるが評価順とエラーは保存する
      bindings.push({ slot: this.allocSlot(), expr: typed.qir })
    }
    throw new CompileFail('末尾に式がありません', loc)
  }

  private compileDef(def: Ast.Definition, scope: Scope, out: QirBinding[]) {
    if (def.mut) {
      throw new CompileFail(
        'var はサブセット外です (let を使ってください)',
        def.loc,
      )
    }
    if (def.varType !== undefined) {
      throw new CompileFail('型注釈はサブセット外です', def.loc)
    }
    if (def.attr.length > 0) {
      throw new CompileFail('属性はサブセット外です', def.loc)
    }
    const name = identifierName(def.dest, def.loc)
    if (def.expr.type === 'fn') {
      // 関数定義: 呼び出し位置で脱糖するため AST とスコープを保持。
      // スコープは定義位置のスナップショット = 前方参照 (定義より後の
      // let/関数を本体から参照) は AiScript より保守的に拒否する。
      // 受理したプログラムの意味は変えない (miscompile ではなく拒否側に倒す)
      scope.set(name, {
        kind: 'fn',
        node: def.expr,
        scope: new Map(scope),
        name,
      })
      return
    }
    const typed = this.compileExpr(def.expr, scope)
    const slot = this.allocSlot()
    out.push({ slot, expr: typed.qir })
    scope.set(name, { kind: 'slot', slot, type: typed.type })
  }

  private allocSlot(): number {
    return this.nextSlot++
  }

  /**
   * null になりうるレシーバを guard なしで操作していたら警告に積む (V25)。
   * コンパイル自体は通す — 止めるかどうかは保存側の判断 (「このまま保存」可)。
   */
  private checkNullableReceiver(recv: Typed, loc: Ast.Loc): void {
    if ((recv.type & T_NULL) === 0) return
    if (recv.notePath === undefined) return
    const field = [this.noteRootName, ...recv.notePath].join('.')
    if (this.guardedPaths.has(field)) return
    if (this.warnings.has(field)) return
    this.warnings.set(field, {
      field,
      guard: `${field} != null`,
      message: `${field} は null のことがあります。ガードしないと、そのノートが丸ごと除外されます`,
      line: loc.start.line,
      column: loc.start.column,
    })
  }

  private compileExpr(node: Ast.Expression, scope: Scope): Typed {
    switch (node.type) {
      case 'str':
        return {
          qir: this.emit({ kind: 'str', value: node.value }),
          type: T_STR,
        }
      case 'num':
        return {
          qir: this.emit({ kind: 'num', value: node.value }),
          type: T_NUM,
        }
      case 'bool':
        return {
          qir: this.emit({ kind: 'bool', value: node.value }),
          type: T_BOOL,
        }
      case 'null':
        return { qir: this.emit({ kind: 'null' }), type: T_NULL }
      case 'identifier':
        return this.compileIdentifier(node, scope)
      case 'prop':
        return this.compileProp(node, scope)
      case 'index':
        return this.compileIndex(node, scope)
      case 'call':
        return this.compileCall(node, scope)
      case 'not': {
        const expr = this.requireBoolish(node.expr, scope, '!')
        return {
          qir: this.emit({ kind: 'not', expr: expr.qir }),
          type: T_BOOL,
        }
      }
      case 'and':
      case 'or': {
        const left = this.requireBoolish(node.left, scope, node.type)
        // `X != null && ...` の右辺では X を non-null として扱う (V25)
        const guard =
          node.type === 'and' ? nullGuardTarget(node.left) : undefined
        const added = guard !== undefined && !this.guardedPaths.has(guard)
        if (added && guard !== undefined) this.guardedPaths.add(guard)
        try {
          const right = this.requireBoolish(node.right, scope, node.type)
          return {
            qir: this.emit({
              kind: node.type,
              left: left.qir,
              right: right.qir,
            }),
            type: T_BOOL,
          }
        } finally {
          if (added && guard !== undefined) this.guardedPaths.delete(guard)
        }
      }
      case 'lt':
      case 'lteq':
      case 'gt':
      case 'gteq': {
        const left = this.compileExpr(node.left, scope)
        const right = this.compileExpr(node.right, scope)
        for (const side of [left, right]) {
          if ((side.type & ~T_NULL) !== T_NUM) {
            throw new CompileFail(`比較 ${node.type} は数値専用です`, node.loc)
          }
        }
        return {
          qir: this.emit({
            kind: 'cmp',
            op: node.type,
            left: left.qir,
            right: right.qir,
          }),
          type: T_BOOL,
        }
      }
      case 'eq':
      case 'neq': {
        const left = this.compileExpr(node.left, scope)
        const right = this.compileExpr(node.right, scope)
        const scalarOrNull = (t: TypeMask) => (t & ~(T_SCALAR | T_NULL)) === 0
        const isNullLiteral = (t: TypeMask) => t === T_NULL
        const allowed =
          (scalarOrNull(left.type) && scalarOrNull(right.type)) ||
          isNullLiteral(left.type) ||
          isNullLiteral(right.type)
        if (!allowed) {
          throw new CompileFail(
            '== / != はスカラー同士か null との比較のみです (配列・オブジェクトの参照等価は QIR で再現できないため)',
            node.loc,
          )
        }
        return {
          qir: this.emit({
            kind: 'eq',
            negated: node.type === 'neq',
            left: left.qir,
            right: right.qir,
          }),
          type: T_BOOL,
        }
      }
      default:
        throw new CompileFail(`サブセット外の構文です: ${node.type}`, node.loc)
    }
  }

  private requireBoolish(
    node: Ast.Expression,
    scope: Scope,
    opName: string,
  ): Typed {
    const typed = this.compileExpr(node, scope)
    if ((typed.type & ~T_NULL) !== T_BOOL) {
      throw new CompileFail(
        `${opName} の項は bool である必要があります`,
        node.loc,
      )
    }
    return typed
  }

  private compileIdentifier(node: Ast.Identifier, scope: Scope): Typed {
    const entry = scope.get(node.name)
    if (!entry) {
      throw new CompileFail(
        `未知の識別子です: ${node.name} (フィルタから参照できるのは note と自分で定義した let/関数のみ)`,
        node.loc,
      )
    }
    if (entry.kind === 'note') {
      return {
        qir: this.emit({ kind: 'field', path: [] }),
        type: T_OBJ,
        notePath: [],
      }
    }
    if (entry.kind === 'fn') {
      throw new CompileFail(
        `関数 ${node.name} は呼び出しの形でのみ使えます`,
        node.loc,
      )
    }
    return {
      qir: this.emit({ kind: 'ref', slot: entry.slot }),
      type: entry.type,
    }
  }

  private compileProp(node: Ast.Prop, scope: Scope): Typed {
    // .len (prop 参照): 配列専用 (str.len は独自計数のため対象外、V20)
    if (node.name === 'len') {
      const target = this.compileExpr(node.target, scope)
      if ((target.type & ~T_NULL) === T_ARR) {
        this.checkNullableReceiver(target, node.loc)
        return {
          qir: this.emit({ kind: 'arrLen', target: target.qir }),
          type: T_NUM,
        }
      }
      throw new CompileFail(
        '.len は配列フィールド専用です (str.len はサブセット外)',
        node.loc,
      )
    }
    const target = this.compileExpr(node.target, scope)
    if (target.notePath === undefined) {
      throw new CompileFail(
        `プロパティ ${node.name} はサブセット外です`,
        node.loc,
      )
    }
    const path = [...target.notePath, node.name]
    const type = NOTE_FIELD_TYPES[path.join('.')]
    if (type === undefined) {
      throw new CompileFail(
        `note.${path.join('.')} はフィールド allowlist 外です`,
        node.loc,
      )
    }
    return {
      qir: this.emit({ kind: 'field', path }),
      type,
      notePath: path,
    }
  }

  private compileIndex(node: Ast.Index, scope: Scope): Typed {
    const target = this.compileExpr(node.target, scope)
    const pathKey = target.notePath?.join('.')
    const valueType =
      pathKey !== undefined ? NOTE_INDEXABLE_VALUE_TYPES[pathKey] : undefined
    if (valueType === undefined) {
      throw new CompileFail(
        'index はリテラルキーによる note.reactions[...] のみです',
        node.loc,
      )
    }
    if (node.index.type !== 'str') {
      throw new CompileFail('index のキーは文字列リテラルのみです', node.loc)
    }
    return {
      qir: this.emit({
        kind: 'objIndex',
        target: target.qir,
        key: node.index.value,
      }),
      type: valueType,
    }
  }

  private compileCall(node: Ast.Call, scope: Scope): Typed {
    const target = node.target
    if (target.type === 'prop') {
      return this.compilePrimitiveOp(node, target, scope)
    }
    if (target.type === 'identifier') {
      const entry = scope.get(target.name)
      if (entry?.kind === 'fn') {
        return this.inlineFnCall(node, entry, scope)
      }
      throw new CompileFail(`未知の関数です: ${target.name}`, node.loc)
    }
    throw new CompileFail('この呼び出し形はサブセット外です', node.loc)
  }

  /** str.incl / starts_with / ends_with / lower / upper、arr.incl */
  private compilePrimitiveOp(
    call: Ast.Call,
    prop: Ast.Prop,
    scope: Scope,
  ): Typed {
    const recv = this.compileExpr(prop.target, scope)
    const recvBase = recv.type & ~T_NULL
    const name = prop.name
    this.checkNullableReceiver(recv, prop.loc)
    if (name === 'lower' || name === 'upper') {
      if (call.args.length !== 0) {
        throw new CompileFail(`${name}() は引数を取りません`, call.loc)
      }
      if (recvBase !== T_STR) {
        throw new CompileFail(`${name}() は文字列専用です`, call.loc)
      }
      return {
        qir: this.emit({ kind: 'strMap', op: name, target: recv.qir }),
        type: T_STR,
      }
    }
    if (name === 'incl') {
      const argNode = call.args[0]
      if (call.args.length !== 1 || argNode === undefined) {
        throw new CompileFail('incl は引数 1 つです', call.loc)
      }
      const needle = this.compileExpr(argNode, scope)
      if (recvBase === T_STR) {
        if ((needle.type & ~T_NULL) !== T_STR) {
          throw new CompileFail('str.incl の引数は文字列です', call.loc)
        }
        return {
          qir: this.emit({
            kind: 'strTest',
            op: 'incl',
            target: recv.qir,
            needle: needle.qir,
          }),
          type: T_BOOL,
        }
      }
      if (recvBase === T_ARR) {
        if ((needle.type & ~(T_SCALAR | T_NULL)) !== 0) {
          throw new CompileFail('arr.incl の引数はスカラーのみです', call.loc)
        }
        return {
          qir: this.emit({
            kind: 'arrIncl',
            target: recv.qir,
            needle: needle.qir,
          }),
          type: T_BOOL,
        }
      }
      throw new CompileFail('incl は文字列か配列専用です', call.loc)
    }
    if (name === 'starts_with' || name === 'ends_with') {
      const argNode = call.args[0]
      if (call.args.length !== 1 || argNode === undefined) {
        throw new CompileFail(
          `${name} は 1 引数形のみサブセットです (index 引数は UTF-16 依存のため降格)`,
          call.loc,
        )
      }
      if (recvBase !== T_STR) {
        throw new CompileFail(`${name} は文字列専用です`, call.loc)
      }
      const needle = this.compileExpr(argNode, scope)
      if ((needle.type & ~T_NULL) !== T_STR) {
        throw new CompileFail(`${name} の引数は文字列です`, call.loc)
      }
      return {
        qir: this.emit({
          kind: 'strTest',
          op: name === 'starts_with' ? 'startsWith' : 'endsWith',
          target: recv.qir,
          needle: needle.qir,
        }),
        type: T_BOOL,
      }
    }
    throw new CompileFail(`メソッド ${name} はサブセット外です`, call.loc)
  }

  /** ユーザー定義関数のインライン脱糖 (V19: 引数 eager + 本体 Let 列)。 */
  private inlineFnCall(call: Ast.Call, entry: FnEntry, scope: Scope): Typed {
    const fn = entry.node
    if (this.inlineStack.includes(fn)) {
      throw new CompileFail(
        `関数 ${entry.name} は再帰しています (再帰はサブセット外)`,
        call.loc,
      )
    }
    if (call.args.length !== fn.params.length) {
      throw new CompileFail(
        `関数 ${entry.name} の引数は ${fn.params.length} 個です`,
        call.loc,
      )
    }
    const bindings: QirBinding[] = []
    // クロージャ: 定義位置のスコープ + パラメータ
    const fnScope: Scope = new Map(entry.scope)
    for (const [i, param] of fn.params.entries()) {
      if (param.optional || param.default !== undefined) {
        throw new CompileFail(
          'オプショナル引数・デフォルト値はサブセット外です',
          fn.loc,
        )
      }
      const argNode = call.args[i]
      if (argNode === undefined) break // arity 検査済みのため到達しない
      const paramName = identifierName(param.dest, fn.loc)
      // call-by-value: 引数は呼び出し位置のスコープで eager 評価
      const arg = this.compileExpr(argNode, scope)
      const slot = this.allocSlot()
      bindings.push({ slot, expr: arg.qir })
      fnScope.set(paramName, { kind: 'slot', slot, type: arg.type })
    }
    this.inlineStack.push(fn)
    try {
      const body = this.compileBodyExpr(fn.children, fnScope, fn.loc)
      if (bindings.length === 0) return body
      return {
        qir: this.emit({ kind: 'let', bindings, body: body.qir }),
        type: body.type,
      }
    } finally {
      this.inlineStack.pop()
    }
  }

  /** 関数本体 (let 列 + 末尾式) をコンパイルし型も返す。 */
  private compileBodyExpr(
    children: (Ast.Statement | Ast.Expression)[],
    scope: Scope,
    loc: Ast.Loc,
  ): Typed {
    if (children.length === 0) {
      throw new CompileFail('関数本体が空です', loc)
    }
    const bindings: QirBinding[] = []
    const localScope: Scope = new Map(scope)
    for (const [i, stmt] of children.entries()) {
      const isLast = i === children.length - 1
      if (stmt.type === 'def') {
        if (isLast) {
          throw new CompileFail('末尾は式である必要があります', stmt.loc)
        }
        this.compileDef(stmt, localScope, bindings)
        continue
      }
      if (!isAstExpression(stmt)) {
        throw new CompileFail(
          `関数本体で使えない構文です: ${stmt.type} (本体は let 列 + 末尾式のみ)`,
          stmt.loc,
        )
      }
      const typed = this.compileExpr(stmt, localScope)
      if (isLast) {
        if (bindings.length === 0) return typed
        return {
          qir: this.emit({ kind: 'let', bindings, body: typed.qir }),
          type: typed.type,
        }
      }
      bindings.push({ slot: this.allocSlot(), expr: typed.qir })
    }
    throw new CompileFail('末尾に式がありません', loc)
  }
}

/**
 * `X != null` / `null != X` の形なら X のフィールドパスを返す (V25)。
 * `==` は「null のときだけ通す」判定なので、右辺で non-null にはならない。
 */
function nullGuardTarget(node: Ast.Expression): string | undefined {
  if (node.type !== 'neq') return undefined
  const path =
    node.right.type === 'null'
      ? notePathOf(node.left)
      : node.left.type === 'null'
        ? notePathOf(node.right)
        : undefined
  return path
}

/** 式が note のフィールド参照そのものなら `note.a.b` 形式で返す */
function notePathOf(node: Ast.Expression): string | undefined {
  const segments: string[] = []
  let cur: Ast.Expression = node
  while (cur.type === 'prop') {
    segments.unshift(cur.name)
    cur = cur.target
  }
  if (cur.type !== 'identifier' || segments.length === 0) return undefined
  return [cur.name, ...segments].join('.')
}

function identifierName(dest: Ast.Expression, loc: Ast.Loc): string {
  if (dest.type !== 'identifier') {
    throw new CompileFail('分割代入はサブセット外です', loc)
  }
  return dest.name
}

const EXPRESSION_TYPES = new Set([
  'if',
  'fn',
  'match',
  'block',
  'exists',
  'tmpl',
  'str',
  'num',
  'bool',
  'null',
  'obj',
  'arr',
  'plus',
  'minus',
  'not',
  'pow',
  'mul',
  'div',
  'rem',
  'add',
  'sub',
  'lt',
  'lteq',
  'gt',
  'gteq',
  'eq',
  'neq',
  'and',
  'or',
  'identifier',
  'call',
  'index',
  'prop',
])

function isAstExpression(node: Ast.Node): node is Ast.Expression {
  return EXPRESSION_TYPES.has(node.type)
}

function qirDepth(node: QirNode): number {
  switch (node.kind) {
    case 'str':
    case 'num':
    case 'bool':
    case 'null':
    case 'field':
    case 'ref':
      return 1
    case 'objIndex':
    case 'arrLen':
    case 'strMap':
      return 1 + qirDepth(node.target)
    case 'not':
      return 1 + qirDepth(node.expr)
    case 'let': {
      let max = qirDepth(node.body)
      for (const b of node.bindings) max = Math.max(max, qirDepth(b.expr))
      return 1 + max
    }
    case 'and':
    case 'or':
    case 'cmp':
    case 'eq':
      return 1 + Math.max(qirDepth(node.left), qirDepth(node.right))
    case 'strTest':
    case 'arrIncl':
      return 1 + Math.max(qirDepth(node.target), qirDepth(node.needle))
  }
}

/** フィルタソースを QIR にコンパイルする。 */
export function compileColumnQuery(source: string): CompileResult {
  return new Compiler().compile(source)
}

/**
 * fetchKey 合成用の QIR ハッシュ (FNV-1a 32bit)。
 * 同一 base・別クエリのカラム間でレスポンスキャッシュを混線させない (V13)。
 * コンパイラのノード構築順は決定的なので JSON.stringify で安定する。
 */
export function hashQirQuery(query: QirQuery): string {
  const s = JSON.stringify(query)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

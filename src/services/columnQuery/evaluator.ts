import type { QirNode, QirQuery } from '@/bindings'

import { QIR_MAX_DEPTH, QIR_SCHEMA_VERSION } from './compiler'

/**
 * JS QIR evaluator (#783)。
 *
 * QIR を note (NormalizedNote の serde 形、camelCase) に対して同期評価する。
 * streaming / fetch / キャッシュ復元 / ページングの enqueue 注入点で使う。
 *
 * 意味論は AiScript 1.2.1 と同一 (不変条件 (a))。golden vector
 * (golden/vectors.json) で参照評価器 (実 AiScript) との一致を CI 検証する。
 *
 * 3 値 (V14):
 *   match / unmatch / error (per-note エラー = 除外 + 診断計上)
 */

export type QirVerdict = 'match' | 'unmatch' | 'error'

/** per-note エラー (null レシーバ・型エラー・非 bool 結果)。 */
class QirEvalError extends Error {}

const FAIL = (msg: string): never => {
  throw new QirEvalError(msg)
}

type Json = unknown

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isScalar(v: Json): v is string | number | boolean {
  const t = typeof v
  return t === 'string' || t === 'number' || t === 'boolean'
}

/**
 * AiScript の `==` (スカラー値比較 + null==null は true、型不一致は false、
 * 非スカラーは参照等価)。非スカラー同士の比較はコンパイラが静的に禁止して
 * いるため (片側 null リテラルのみ許可)、参照等価分岐は防御的な互換実装。
 */
function aiEq(l: Json, r: Json): boolean {
  const ln = l === null || l === undefined
  const rn = r === null || r === undefined
  if (ln || rn) return ln && rn
  if (isScalar(l) && isScalar(r)) {
    return typeof l === typeof r && l === r
  }
  return l === r
}

class QirEvaluator {
  private slots = new Map<number, Json>()
  private note: Json
  constructor(note: Json) {
    this.note = note
  }

  evalNode(node: QirNode, depth: number): Json {
    if (depth > QIR_MAX_DEPTH) return FAIL('depth limit')
    const d = depth + 1
    switch (node.kind) {
      case 'str':
      case 'num':
      case 'bool':
        return node.value
      case 'null':
        return null
      case 'field': {
        let cur: Json = this.note
        for (const key of node.path) {
          if (cur === null || cur === undefined) {
            return FAIL(`null のプロパティ ${key} を参照しました`)
          }
          if (!isPlainObject(cur)) {
            return FAIL(`プロパティ ${key} を参照できない値です`)
          }
          cur = cur[key] ?? null
        }
        return cur ?? null
      }
      case 'objIndex': {
        const target = this.evalNode(node.target, d)
        if (target === null || target === undefined) {
          return FAIL('null への index 参照です')
        }
        if (!isPlainObject(target))
          return FAIL('index 対象が obj ではありません')
        return target[node.key] ?? null
      }
      case 'arrLen': {
        const target = this.evalNode(node.target, d)
        if (!Array.isArray(target)) return FAIL('.len 対象が配列ではありません')
        return target.length
      }
      case 'let': {
        for (const b of node.bindings) {
          // eager 評価 + エラー伝播 (V19)。値が使われなくてもここで落ちる
          this.slots.set(b.slot, this.evalNode(b.expr, d))
        }
        return this.evalNode(node.body, d)
      }
      case 'ref': {
        const v = this.slots.get(node.slot)
        // コンパイラが割当済みスロットのみ参照を出すため、未設定は QIR 破損
        if (v === undefined && !this.slots.has(node.slot)) {
          return FAIL('未初期化スロット参照 (QIR 破損)')
        }
        return v ?? null
      }
      case 'not': {
        const v = this.evalNode(node.expr, d)
        if (typeof v !== 'boolean') return FAIL('! の項が bool ではありません')
        return !v
      }
      case 'and': {
        const l = this.evalNode(node.left, d)
        if (typeof l !== 'boolean')
          return FAIL('&& の左辺が bool ではありません')
        if (!l) return false
        const r = this.evalNode(node.right, d)
        if (typeof r !== 'boolean')
          return FAIL('&& の右辺が bool ではありません')
        return r
      }
      case 'or': {
        const l = this.evalNode(node.left, d)
        if (typeof l !== 'boolean')
          return FAIL('|| の左辺が bool ではありません')
        if (l) return true
        const r = this.evalNode(node.right, d)
        if (typeof r !== 'boolean')
          return FAIL('|| の右辺が bool ではありません')
        return r
      }
      case 'cmp': {
        const l = this.evalNode(node.left, d)
        const r = this.evalNode(node.right, d)
        if (typeof l !== 'number' || typeof r !== 'number') {
          return FAIL('比較は数値専用です')
        }
        switch (node.op) {
          case 'lt':
            return l < r
          case 'lteq':
            return l <= r
          case 'gt':
            return l > r
          case 'gteq':
            return l >= r
        }
        break
      }
      case 'eq': {
        const l = this.evalNode(node.left, d)
        const r = this.evalNode(node.right, d)
        const eq = aiEq(l, r)
        return node.negated ? !eq : eq
      }
      case 'strTest': {
        const target = this.evalNode(node.target, d)
        if (target === null || target === undefined) {
          return FAIL('null に文字列演算を適用しました')
        }
        if (typeof target !== 'string')
          return FAIL('文字列演算の対象が str ではありません')
        const needle = this.evalNode(node.needle, d)
        if (typeof needle !== 'string')
          return FAIL('文字列演算の引数が str ではありません')
        switch (node.op) {
          case 'incl':
            return target.includes(needle)
          case 'startsWith':
            return target.startsWith(needle)
          case 'endsWith':
            return target.endsWith(needle)
        }
        break
      }
      case 'strMap': {
        const target = this.evalNode(node.target, d)
        if (target === null || target === undefined) {
          return FAIL('null に文字列演算を適用しました')
        }
        if (typeof target !== 'string')
          return FAIL('文字列演算の対象が str ではありません')
        return node.op === 'lower' ? target.toLowerCase() : target.toUpperCase()
      }
      case 'arrIncl': {
        const target = this.evalNode(node.target, d)
        if (target === null || target === undefined) {
          return FAIL('null に incl を適用しました')
        }
        if (!Array.isArray(target))
          return FAIL('incl の対象が配列ではありません')
        const needle = this.evalNode(node.needle, d)
        return target.some((el) => aiEq(el, needle))
      }
    }
    return FAIL('未知の QIR ノードです')
  }
}

/**
 * コンパイル済みクエリを 1 ノートに対して評価する。
 * note は NormalizedNote の serde 形 (不変条件 (g))。
 */
export function evaluateQirQuery(query: QirQuery, note: unknown): QirVerdict {
  if (query.schemaVersion !== QIR_SCHEMA_VERSION) return 'error'
  try {
    const result = new QirEvaluator(note).evalNode(query.root, 1)
    if (typeof result !== 'boolean') return 'error'
    return result ? 'match' : 'unmatch'
  } catch (e) {
    if (e instanceof QirEvalError) return 'error'
    throw e
  }
}

import type { QirNode, QirQuery } from '@/bindings'

/**
 * 複数 ⚡ パーツの QIR を And 合成する (#965)。
 *
 * let のスロット番号はパーツごとに 0 起点で独立に割り当てられるため、
 * そのまま束ねるとパーツ間で衝突し「slot は式全体で一意」という QIR の
 * 契約 (column_query.rs QirBinding) が壊れる。合成前に各パーツのスロットを
 * 「前パーツまでの最大スロット + 1」でオフセットして一意性を保つ。
 *
 * スロットを持つノードは let (bindings[].slot = 定義) と ref (slot = 参照)
 * の 2 種のみ (bindings.ts / evaluator.ts / column_query.rs の QirNode 定義)。
 */

/** ノード以下で使われている最大スロット番号。スロットが無ければ -1 */
function maxSlot(node: QirNode): number {
  switch (node.kind) {
    case 'str':
    case 'num':
    case 'bool':
    case 'null':
    case 'field':
      return -1
    case 'ref':
      return node.slot
    case 'let': {
      let max = maxSlot(node.body)
      for (const b of node.bindings) {
        max = Math.max(max, b.slot, maxSlot(b.expr))
      }
      return max
    }
    case 'objIndex':
    case 'arrLen':
    case 'strMap':
      return maxSlot(node.target)
    case 'not':
      return maxSlot(node.expr)
    case 'and':
    case 'or':
    case 'cmp':
    case 'eq':
      return Math.max(maxSlot(node.left), maxSlot(node.right))
    case 'strTest':
    case 'arrIncl':
      return Math.max(maxSlot(node.target), maxSlot(node.needle))
  }
}

/** スロット番号 (let の定義と ref の参照の両方) を offset だけずらした複製 */
function shiftSlots(node: QirNode, offset: number): QirNode {
  if (offset === 0) return node
  switch (node.kind) {
    case 'str':
    case 'num':
    case 'bool':
    case 'null':
    case 'field':
      return node
    case 'ref':
      return { kind: 'ref', slot: node.slot + offset }
    case 'let':
      return {
        kind: 'let',
        bindings: node.bindings.map((b) => ({
          slot: b.slot + offset,
          expr: shiftSlots(b.expr, offset),
        })),
        body: shiftSlots(node.body, offset),
      }
    case 'objIndex':
      return { ...node, target: shiftSlots(node.target, offset) }
    case 'arrLen':
      return { ...node, target: shiftSlots(node.target, offset) }
    case 'strMap':
      return { ...node, target: shiftSlots(node.target, offset) }
    case 'not':
      return { ...node, expr: shiftSlots(node.expr, offset) }
    case 'and':
    case 'or':
    case 'cmp':
    case 'eq':
      return {
        ...node,
        left: shiftSlots(node.left, offset),
        right: shiftSlots(node.right, offset),
      }
    case 'strTest':
    case 'arrIncl':
      return {
        ...node,
        target: shiftSlots(node.target, offset),
        needle: shiftSlots(node.needle, offset),
      }
  }
}

/**
 * QIR パーツ列を単一の QIR に And 合成する。
 *
 * - 空配列 → null
 * - 1 個 → そのまま返す (再構築しない)
 * - 複数 → スロットを renumber して左結合の And で束ねる。評価順・短絡は
 *   queryAdmitsFast のパーツ順 And と同じ (先頭パーツが unmatch なら後続は
 *   評価されない)
 * - schemaVersion が全パーツで一致しないものは合成できない → null
 */
export function composeQir(parts: QirQuery[]): QirQuery | null {
  const first = parts[0]
  if (first === undefined) return null
  if (parts.some((p) => p.schemaVersion !== first.schemaVersion)) return null
  if (parts.length === 1) return first
  let root = first.root
  let nextOffset = maxSlot(first.root) + 1
  for (const part of parts.slice(1)) {
    const shifted = shiftSlots(part.root, nextOffset)
    // スロットを持たないパーツでは maxSlot が -1 → オフセットは前進しない
    nextOffset = Math.max(nextOffset, maxSlot(shifted) + 1)
    root = { kind: 'and', left: root, right: shifted }
  }
  return { schemaVersion: first.schemaVersion, root }
}

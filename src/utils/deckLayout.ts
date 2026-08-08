/** Find the group index containing a column ID. */
export function groupIndexOf(layout: string[][], colId: string): number {
  for (let i = 0; i < layout.length; i++) {
    if (layout[i]?.includes(colId)) return i
  }
  return -1
}

/** Swap two layout groups by index. Returns null if indices are invalid. */
export function swapGroups(
  layout: string[][],
  aIdx: number,
  bIdx: number,
): string[][] | null {
  if (aIdx < 0 || bIdx < 0 || aIdx >= layout.length || bIdx >= layout.length)
    return null
  const a = layout[aIdx]
  const b = layout[bIdx]
  if (!a || !b) return null
  const result = [...layout]
  result[aIdx] = b
  result[bIdx] = a
  return result
}

/** Move a column into another column's group (stacking). Returns null on failure. */
export function stackColumn(
  layout: string[][],
  fromId: string,
  toId: string,
  position: 'above' | 'below',
): string[][] | null {
  if (fromId === toId) return null
  const fromGroupIdx = groupIndexOf(layout, fromId)
  const toGroupIdx = groupIndexOf(layout, toId)
  if (fromGroupIdx < 0 || toGroupIdx < 0) return null

  const fromGroup = layout[fromGroupIdx]
  if (!fromGroup) return null
  const newFromGroup = fromGroup.filter((id) => id !== fromId)

  const newLayout = [...layout]
  if (newFromGroup.length === 0) {
    newLayout.splice(fromGroupIdx, 1)
  } else {
    newLayout[fromGroupIdx] = newFromGroup
  }

  const targetIdx = groupIndexOf(newLayout, toId)
  if (targetIdx < 0) return null
  const targetGroup = newLayout[targetIdx]
  if (!targetGroup) return null

  const toPos = targetGroup.indexOf(toId)
  const insertAt = position === 'above' ? toPos : toPos + 1
  const newTargetGroup = [...targetGroup]
  newTargetGroup.splice(insertAt, 0, fromId)
  newLayout[targetIdx] = newTargetGroup

  return newLayout
}

/** Swap two columns within the same group. Returns null on failure. */
export function swapInGroup(
  layout: string[][],
  idA: string,
  idB: string,
): string[][] | null {
  if (idA === idB) return null
  const groupIdx = groupIndexOf(layout, idA)
  if (groupIdx < 0) return null
  const group = layout[groupIdx]
  if (!group) return null
  const posA = group.indexOf(idA)
  const posB = group.indexOf(idB)
  if (posA < 0 || posB < 0) return null
  const newGroup = [...group]
  newGroup[posA] = idB
  newGroup[posB] = idA
  const result = [...layout]
  result[groupIdx] = newGroup
  return result
}

/**
 * Whether moving a column to `targetIndex` would leave the layout unchanged.
 *
 * スタック中のカラムは、自分のグループのすぐ隣に挿入してもグループから
 * 抜けるという変化が起きるので no-op ではない (#1026)。
 */
export function isInsertNoop(
  layout: string[][],
  id: string,
  targetIndex: number,
): boolean {
  const groupIdx = groupIndexOf(layout, id)
  if (groupIdx < 0) return false
  const group = layout[groupIdx]
  if (!group || group.length > 1) return false
  return targetIndex === groupIdx || targetIndex === groupIdx + 1
}

/** Move a column to a new group at the target index. Returns null on failure. */
export function insertColumnAt(
  layout: string[][],
  id: string,
  targetIndex: number,
): string[][] | null {
  const groupIdx = groupIndexOf(layout, id)
  if (groupIdx < 0) return null
  const group = layout[groupIdx]
  if (!group) return null

  if (isInsertNoop(layout, id, targetIndex)) return null

  const newGroup = group.filter((colId) => colId !== id)
  const newLayout = [...layout]
  if (newGroup.length === 0) {
    newLayout.splice(groupIdx, 1)
  } else {
    newLayout[groupIdx] = newGroup
  }

  const adjustedIndex =
    newGroup.length === 0 && targetIndex > groupIdx
      ? targetIndex - 1
      : targetIndex
  const clampedIndex = Math.max(0, Math.min(adjustedIndex, newLayout.length))
  newLayout.splice(clampedIndex, 0, [id])
  return newLayout
}

/**
 * Convert an insert index counted on a per-window layout into an index on the
 * full deck layout.
 *
 * ドラッグの挿入位置は画面に並んでいるカラム (= 現ウィンドウ分) を数えて
 * 決まるが、レイアウトの書き換えはデッキ全体に対して行う。別ウィンドウへ
 * 切り出したカラムがあると 2 つの並びは長さが違うので、そのまま渡すと
 * 位置がずれる (#1027)。
 */
export function toGlobalInsertIndex(
  layout: string[][],
  windowLayout: string[][],
  windowIndex: number,
): number {
  if (windowLayout.length === 0) return layout.length
  const clamped = Math.max(0, Math.min(windowIndex, windowLayout.length))

  // 末尾に落としたときは「このウィンドウの最後のカラムの直後」
  const atEnd = clamped === windowLayout.length
  const anchor = windowLayout[atEnd ? windowLayout.length - 1 : clamped]?.[0]
  const anchorIdx = anchor ? groupIndexOf(layout, anchor) : -1
  if (anchorIdx < 0) return layout.length
  return atEnd ? anchorIdx + 1 : anchorIdx
}

/** Remove a column from its group into its own new group. Returns null on failure. */
export function unstackColumn(
  layout: string[][],
  id: string,
): string[][] | null {
  const groupIdx = groupIndexOf(layout, id)
  if (groupIdx < 0) return null
  const group = layout[groupIdx]
  if (!group || group.length <= 1) return null

  const newGroup = group.filter((colId) => colId !== id)
  const newLayout = [...layout]
  newLayout[groupIdx] = newGroup
  newLayout.splice(groupIdx + 1, 0, [id])
  return newLayout
}

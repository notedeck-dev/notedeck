import type { NormalizedNote } from '@/adapters/types'

/**
 * 表示ノートから Note Capture (subNote) の対象を予算内で列挙する。
 *
 * 予算 (`noteCaptureMax`) は実際の購読数で数える。本体と renote 元は別々の
 * subNote なので両方数え、上から順に「1 ノート分 (本体 + renote 元) が収まる
 * 間」だけ採る。ノートの途中で切って本体だけ購読すると、純粋 Renote は見えて
 * いる本文 (renote 元) の反応だけ更新されなくなるので、ノート単位で打ち切る。
 *
 * 戻り値は accountId → noteId 集合 (購読はそのアカウントの接続で行う、#1058 §6)。
 */
export function captureTargets(
  notes: readonly NormalizedNote[],
  budget: number,
): Map<string, Set<string>> {
  const wanted = new Map<string, Set<string>>()
  let remaining = budget
  for (const note of notes) {
    let ids = wanted.get(note._accountId)
    const fresh = [note.id, note.renoteId].filter(
      (id): id is string => !!id && !ids?.has(id),
    )
    if (fresh.length > remaining) break
    if (!ids) {
      ids = new Set()
      wanted.set(note._accountId, ids)
    }
    for (const id of fresh) ids.add(id)
    remaining -= fresh.length
  }
  return wanted
}

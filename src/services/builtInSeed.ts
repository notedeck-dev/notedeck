/**
 * built-in テンプレの seed 判定 (#782 Phase 2、plugins / skills 共通)。
 *
 * - 既に同 id のアイテムがある → ユーザー編集を尊重して追加しない
 *   (seed 済み扱いに昇格し、テンプレ削除時の再 seed も防ぐ)
 * - 過去に seed 済み (= ユーザーが意図的に削除した) → 再生成しない
 * - 未知の built-in id のみ toAdd
 */
export interface BuiltInSeedPlan<T> {
  toAdd: T[]
  /** storage へ書き戻す更新済みの seed 済み id 一覧 (toAdd 分を含む) */
  seededIds: string[]
}

export function planBuiltInSeed<T>(
  templates: readonly T[],
  idOf: (tpl: T) => string,
  seenIds: ReadonlySet<string>,
  previouslySeeded: ReadonlySet<string>,
): BuiltInSeedPlan<T> {
  const seeded = new Set(previouslySeeded)
  const toAdd: T[] = []
  for (const tpl of templates) {
    const id = idOf(tpl)
    if (seenIds.has(id)) {
      seeded.add(id)
      continue
    }
    if (seeded.has(id)) continue
    toAdd.push(tpl)
    seeded.add(id)
  }
  return { toAdd, seededIds: Array.from(seeded) }
}

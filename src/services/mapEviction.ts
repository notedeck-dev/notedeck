/**
 * ID → アイテムの Map に対する 2-pass 退避 (#782)。
 * notes / chatMessageStore が同型実装していた退避アルゴリズムの共通化。
 *
 * 1st pass: `live` (どのカラムからも参照されていない) でないものを
 *   挿入順 (= 古い順、get の LRU refresh 込み) に削除
 * 2nd pass: それでも上限超過なら createdAt が古い順に削除
 *   (put の insertion order が保証されないパスでも新着を守る)
 *
 * Map の規模は上限前後 (数百規模) なので sort コストは無視できる。
 */
export function evictByLiveness<T>(
  map: Map<string, T>,
  max: number,
  live: ReadonlySet<string>,
  createdAtOf: (item: T) => string,
  idOf: (item: T) => string,
): void {
  if (map.size <= max) return

  // 1st pass: 参照されていないものを古い順に削除
  if (live.size < map.size) {
    for (const key of map.keys()) {
      if (map.size <= max) break
      if (!live.has(key)) map.delete(key)
    }
  }

  // 2nd pass: 全アイテムが live 内の稀なケース
  if (map.size > max) {
    const excess = map.size - max
    const byAge: T[] = []
    for (const item of map.values()) byAge.push(item)
    byAge.sort((a, b) => {
      const ca = createdAtOf(a)
      const cb = createdAtOf(b)
      return ca < cb ? -1 : ca > cb ? 1 : 0
    })
    for (let i = 0; i < excess && i < byAge.length; i++) {
      const item = byAge[i]
      if (item) map.delete(idOf(item))
    }
  }
}

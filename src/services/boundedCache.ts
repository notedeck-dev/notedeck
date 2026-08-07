/**
 * 上限つきキャッシュの共通基盤 (#987)。
 *
 * 「キャッシュには必ず上限」を守る側の受け皿。長時間起動でメモリが単調増加
 * する経路は、たいてい「モジュールスコープに素の Map を置いて delete を
 * 書き忘れた」形で入る (blurhash / 絵文字辞書がそうだった)。個別に cap を
 * 足して回るのではなく、ここを通すことで上限を構造的に保証する。
 *
 * 上限は関数でも渡せる。performance.json5 のノブは実行中に変わるので、
 * 生成時の値で固定すると設定が効かない死にノブになる (#921 と同型の事故)。
 *
 * eviction は挿入順ベースの LRU。`evictByLiveness` (notes / chat) と違い、
 * 「どのカラムから参照されているか」を持たない純粋な派生データ用。
 */

export interface BoundedCache<K, V> {
  get(key: K): V | undefined
  has(key: K): boolean
  set(key: K, value: V): void
  delete(key: K): boolean
  clear(): void
  /** 古い順 (次に捨てられる順) */
  keys(): IterableIterator<K>
  /** 古い順 (次に捨てられる順) */
  entries(): IterableIterator<[K, V]>
  readonly size: number
}

export function createBoundedCache<K, V>(
  max: number | (() => number),
): BoundedCache<K, V> {
  const map = new Map<K, V>()
  // 0 以下は「キャッシュ無効」ではなく 1 に丸める。設定ミスで毎回の
  // 再計算に落ちるより、最小限でも効いているほうが害が小さい。
  // 非有限 (NaN / Infinity — JSON5 の手編集で到達可能) も 1 に落とす:
  // Math.max(1, NaN) は NaN で eviction 比較が常に false になり、
  // 「必ず上限」の不変条件 (#987) が静かに破れる
  const maxOf = () => {
    const value = typeof max === 'function' ? max() : max
    return Number.isFinite(value) ? Math.max(1, value) : 1
  }

  return {
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key) as V
      // 触ったものを末尾へ (挿入順 = LRU 順を保つ)
      map.delete(key)
      map.set(key, value)
      return value
    },
    has: (key) => map.has(key),
    set(key, value) {
      map.delete(key)
      map.set(key, value)
      const limit = maxOf()
      while (map.size > limit) {
        const oldest = map.keys().next()
        if (oldest.done) break
        map.delete(oldest.value)
      }
    },
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    keys: () => map.keys(),
    entries: () => map.entries(),
    get size() {
      return map.size
    },
  }
}

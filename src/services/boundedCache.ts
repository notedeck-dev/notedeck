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

export interface BoundedCacheStat {
  name: string
  size: number
  limit: number
}

/**
 * 観測レジストリ (#977 / #987)。名前付きで生成されたキャッシュを WeakRef で
 * 保持し、dev ダッシュボードが size / limit を一覧する。「必ず上限」の
 * 不変条件が実測で見える面。WeakRef なのでコンポーネント寿命のキャッシュ
 * (カラム単位等) は GC されれば自動で一覧から消える (レジストリが寿命を
 * 延ばさない)。
 */
const registry = new Map<
  number,
  {
    name: string
    ref: WeakRef<BoundedCache<unknown, unknown>>
    maxOf: () => number
  }
>()
let registrySeq = 0

export function listBoundedCacheStats(): BoundedCacheStat[] {
  const stats: BoundedCacheStat[] = []
  for (const [id, entry] of registry) {
    const cache = entry.ref.deref()
    if (!cache) {
      registry.delete(id)
      continue
    }
    stats.push({ name: entry.name, size: cache.size, limit: entry.maxOf() })
  }
  return stats
}

export function createBoundedCache<K, V>(
  max: number | (() => number),
  /** 観測レジストリに載せる名前。省略時は非登録 */
  name?: string,
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

  const cache: BoundedCache<K, V> = {
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

  if (name) {
    // 死んだ WeakRef は登録時にも掃除する — 一覧が読まれなくても
    // エントリ数が「生きているキャッシュの数」を超えて育たない (#987)
    for (const [id, entry] of registry) {
      if (!entry.ref.deref()) registry.delete(id)
    }
    registry.set(++registrySeq, {
      name,
      ref: new WeakRef(cache as BoundedCache<unknown, unknown>),
      maxOf,
    })
  }

  return cache
}

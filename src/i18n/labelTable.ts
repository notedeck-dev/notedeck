/**
 * 「種別 → 表示名」の表を、参照したときに引く形で作る (#135)。
 *
 * レジストリの表示名は辞書から引くが、辞書は起動待ちの中で読むので、
 * モジュールの読み込み時に表へコピーすると読む前に参照して落ちる。表は
 * Proxy にして、`table[type]` を参照した時点で `labelOf(type)` を呼ぶ。
 * 呼び出し側の `LABELS[type] ?? type` / `Object.keys(LABELS)` はそのまま動く。
 */
export function labelTable(
  keys: () => readonly string[],
  labelOf: (key: string) => string | undefined,
): Record<string, string> {
  const has = (key: string | symbol) =>
    typeof key === 'string' && keys().includes(key)
  return new Proxy({} as Record<string, string>, {
    get: (_, key) => (has(key) ? labelOf(key as string) : undefined),
    has: (_, key) => has(key),
    ownKeys: () => [...keys()],
    getOwnPropertyDescriptor: (_, key) =>
      has(key)
        ? {
            configurable: true,
            enumerable: true,
            value: labelOf(key as string),
          }
        : undefined,
  })
}

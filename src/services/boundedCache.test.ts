import { describe, expect, it } from 'vitest'
import { createBoundedCache } from '@/services/boundedCache'

describe('createBoundedCache', () => {
  it('上限を超えたら最も古いエントリから捨てる', () => {
    const cache = createBoundedCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    expect(cache.size).toBe(2)
    expect(cache.has('a')).toBe(false)
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('get したエントリは新しい扱いになる (LRU)', () => {
    const cache = createBoundedCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // a を触ったので、次に捨てられるのは b
    cache.set('c', 3)

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('同じキーの上書きはサイズを増やさない', () => {
    const cache = createBoundedCache<string, number>(2)
    cache.set('a', 1)
    cache.set('a', 2)

    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe(2)
  })

  it('undefined を値として保持できる (has と get を混同しない)', () => {
    const cache = createBoundedCache<string, number | undefined>(2)
    cache.set('a', undefined)

    expect(cache.has('a')).toBe(true)
    expect(cache.get('a')).toBeUndefined()
  })

  it('上限を関数で渡すと、設定変更が次の set から効く', () => {
    let max = 3
    const cache = createBoundedCache<string, number>(() => max)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.size).toBe(3)

    max = 1
    cache.set('d', 4)

    expect(cache.size).toBe(1)
    expect(cache.get('d')).toBe(4)
  })

  it('上限 0 以下は 1 に丸める (設定ミスでキャッシュが機能不全にならない)', () => {
    const cache = createBoundedCache<string, number>(0)
    cache.set('a', 1)

    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe(1)
  })

  it('delete と clear でエントリを落とせる', () => {
    const cache = createBoundedCache<string, number>(4)
    cache.set('a', 1)
    cache.set('b', 2)

    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('a')).toBe(false)
    expect(cache.size).toBe(1)

    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('古い順に列挙できる (永続化で「新しい N 件」を選ぶため)', () => {
    const cache = createBoundedCache<string, number>(4)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.get('a')

    expect([...cache.keys()]).toEqual(['b', 'c', 'a'])
    expect([...cache.entries()]).toEqual([
      ['b', 2],
      ['c', 3],
      ['a', 1],
    ])
  })
})

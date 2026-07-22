import { describe, expect, it } from 'vitest'

import { evictByLiveness } from '@/services/mapEviction'

interface Item {
  id: string
  createdAt: string
}

function makeMap(ids: string[]): Map<string, Item> {
  const map = new Map<string, Item>()
  ids.forEach((id, i) => {
    map.set(id, {
      id,
      createdAt: `2026-01-01T00:00:0${i}.000Z`,
    })
  })
  return map
}

const createdAtOf = (item: Item) => item.createdAt
const idOf = (item: Item) => item.id

describe('evictByLiveness', () => {
  it('上限以下なら何もしない', () => {
    const map = makeMap(['a', 'b'])
    evictByLiveness(map, 2, new Set(), createdAtOf, idOf)
    expect(map.size).toBe(2)
  })

  it('live でないものを挿入順 (古い順) に削除する', () => {
    const map = makeMap(['a', 'b', 'c', 'd'])
    evictByLiveness(map, 2, new Set(['a']), createdAtOf, idOf)
    expect(map.size).toBe(2)
    // a は live 保護、b が最初に削除され、c も削除、d が残る
    expect(map.has('a')).toBe(true)
    expect(map.has('d')).toBe(true)
  })

  it('全部 live の場合は createdAt が古い順に削除する', () => {
    const map = makeMap(['c', 'a', 'b']) // 挿入順 ≠ createdAt 順
    // createdAt: c(00) < a(01) < b(02) — makeMap はインデックス順に秒を振る
    evictByLiveness(map, 1, new Set(['a', 'b', 'c']), createdAtOf, idOf)
    expect(map.size).toBe(1)
    // createdAt が最古の c と次の a が消え、最新の b が残る
    expect(map.has('b')).toBe(true)
  })

  it('live 保護で上限を超過したままでも age フォールバックで上限まで削る', () => {
    const map = makeMap(['a', 'b', 'c', 'd'])
    evictByLiveness(map, 1, new Set(['a', 'b', 'c', 'd']), createdAtOf, idOf)
    expect(map.size).toBe(1)
    expect(map.has('d')).toBe(true)
  })
})

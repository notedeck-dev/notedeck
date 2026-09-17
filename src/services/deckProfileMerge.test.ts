import { describe, expect, it } from 'vitest'
import type { DeckProfile } from '@/stores/deck'
import { selectMemoryOnlyProfiles } from './deckProfileMerge'

const profile = (id: string, name: string, createdAt: number): DeckProfile => ({
  id,
  name,
  columns: [],
  layout: [],
  createdAt,
})

describe('selectMemoryOnlyProfiles', () => {
  it('ファイルが無ければメモリ側をそのまま返す (仮プロファイルも残す)', () => {
    const mem = [profile('p1', 'A', 1)]
    expect(selectMemoryOnlyProfiles(mem, [], 'p1')).toEqual(mem)
  })

  it('ID が一致するものはファイル側を正として落とす', () => {
    const mem = [profile('p1', 'A', 1), profile('p2', 'B', 2)]
    expect(
      selectMemoryOnlyProfiles(mem, [profile('p1', 'A (renamed)', 9)], null),
    ).toEqual([profile('p2', 'B', 2)])
  })

  it('名前 + 作成日時が一致するものも複製とみなして落とす', () => {
    const mem = [profile('stale', 'A', 1)]
    expect(
      selectMemoryOnlyProfiles(mem, [profile('fresh', 'A', 1)], null),
    ).toEqual([])
  })

  it('初回起動用の仮プロファイルはファイルがあれば捨てる', () => {
    const mem = [
      profile('placeholder', 'プロファイル 1', 5),
      profile('p2', 'B', 2),
    ]
    expect(
      selectMemoryOnlyProfiles(
        mem,
        [profile('main', 'メイン', 1)],
        'placeholder',
      ),
    ).toEqual([profile('p2', 'B', 2)])
  })
})

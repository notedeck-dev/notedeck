import { describe, expect, it } from 'vitest'
import {
  recountVisibleReactions,
  totalReactionCount,
} from '@/services/reactionRecount'

describe('recountVisibleReactions (#575)', () => {
  it('keeps counts for reactions still present in the visible listing', () => {
    const result = recountVisibleReactions({ '❤': 2, ':petthex@.:': 1 }, [
      { type: '❤', userId: 'u1' },
      { type: '❤', userId: 'u2' },
      { type: ':petthex@.:', userId: 'u3' },
    ])
    expect(result).toEqual({ '❤': 2, ':petthex@.:': 1 })
  })

  it('reduces count when muted users are excluded from the listing', () => {
    const result = recountVisibleReactions({ '❤': 3 }, [
      { type: '❤', userId: 'u1' },
      { type: '❤', userId: 'u2' },
    ])
    expect(result).toEqual({ '❤': 2 })
  })

  it('drops the emoji entirely when all reactors are hidden', () => {
    const result = recountVisibleReactions(
      { '❤': 1, ':uoooo_dynamic@misskey.io:': 1 },
      [{ type: '❤', userId: 'u1' }],
    )
    expect(result).toEqual({ '❤': 1 })
  })

  it('subtracts records matching isHiddenUser (suspended / just-muted)', () => {
    const result = recountVisibleReactions(
      { '❤': 2, '👍': 1 },
      [
        { type: '❤', userId: 'u1' },
        { type: '❤', userId: 'suspended' },
        { type: '👍', userId: 'suspended' },
      ],
      (userId) => userId === 'suspended',
    )
    expect(result).toEqual({ '❤': 1 })
  })

  it('matches across key notation variations (@. suffix)', () => {
    // サーバー集計キーと列挙側 type の表記が揺れても突き合わせられる
    const result = recountVisibleReactions({ ':blobcat@.:': 2 }, [
      { type: ':blobcat:', userId: 'u1' },
      { type: ':blobcat@.:', userId: 'u2' },
    ])
    expect(result).toEqual({ ':blobcat@.:': 2 })
  })

  it('returns empty for empty inputs', () => {
    expect(recountVisibleReactions({}, [])).toEqual({})
    expect(recountVisibleReactions({ '❤': 1 }, [])).toEqual({})
  })
})

describe('totalReactionCount', () => {
  it('sums all reaction counts', () => {
    expect(totalReactionCount({ '❤': 2, '👍': 3 })).toBe(5)
    expect(totalReactionCount({})).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import {
  insertIntoSorted,
  mergeSortedNotes,
  sortByCreatedAtDesc,
} from '@/utils/sortNotes'

function makeNote(id: string, createdAt: string): NormalizedNote {
  return {
    id,
    createdAt,
    text: null,
    cw: null,
    user: {
      id: 'u1',
      username: 'testuser',
      host: null,
      name: null,
      avatarUrl: null,
    },
    visibility: 'public',
    reactions: {},
    emojis: {},
    reactionEmojis: {},
    files: [],
    renoteCount: 0,
    repliesCount: 0,
    _accountId: 'a1',
    _serverHost: 'example.com',
  }
}

const t = (n: number) => `2025-01-01T00:00:${String(n).padStart(2, '0')}.000Z`

describe('sortByCreatedAtDesc', () => {
  it('sorts newest first, in place', () => {
    const notes = [
      makeNote('a', t(1)),
      makeNote('b', t(3)),
      makeNote('c', t(2)),
    ]
    const result = sortByCreatedAtDesc(notes)
    expect(result).toBe(notes)
    expect(result.map((n) => n.id)).toEqual(['b', 'c', 'a'])
  })

  it('handles empty and single-element arrays', () => {
    expect(sortByCreatedAtDesc([])).toEqual([])
    const single = [makeNote('a', t(1))]
    expect(sortByCreatedAtDesc(single).map((n) => n.id)).toEqual(['a'])
  })
})

describe('mergeSortedNotes', () => {
  it('merges two sorted arrays preserving descending order', () => {
    const a = [makeNote('a1', t(5)), makeNote('a2', t(3))]
    const b = [makeNote('b1', t(4)), makeNote('b2', t(2))]
    expect(mergeSortedNotes(a, b).map((n) => n.id)).toEqual([
      'a1',
      'b1',
      'a2',
      'b2',
    ])
  })

  it('dedupes by id — entry from a wins on equal timestamps', () => {
    const fromA = makeNote('dup', t(3))
    const fromB = makeNote('dup', t(3))
    const result = mergeSortedNotes([fromA], [fromB, makeNote('b2', t(1))])
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(fromA)
  })

  it('handles empty inputs', () => {
    const a = [makeNote('a1', t(1))]
    expect(mergeSortedNotes(a, []).map((n) => n.id)).toEqual(['a1'])
    expect(mergeSortedNotes([], a).map((n) => n.id)).toEqual(['a1'])
    expect(mergeSortedNotes([], [])).toEqual([])
  })
})

describe('insertIntoSorted', () => {
  it('returns sorted array unchanged for empty batch', () => {
    const sorted = [makeNote('a', t(2))]
    expect(insertIntoSorted(sorted, [])).toBe(sorted)
  })

  it('sorts the batch when sorted array is empty', () => {
    const batch = [makeNote('a', t(1)), makeNote('b', t(2))]
    expect(insertIntoSorted([], batch).map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('inserts a single streaming note at the right position', () => {
    const sorted = [makeNote('a', t(5)), makeNote('b', t(1))]
    const result = insertIntoSorted(sorted, [makeNote('n', t(3))])
    expect(result.map((n) => n.id)).toEqual(['a', 'n', 'b'])
  })

  it('inserts an unsorted batch without mutating it', () => {
    const sorted = [makeNote('a', t(4))]
    const batch = [makeNote('old', t(1)), makeNote('new', t(6))]
    const result = insertIntoSorted(sorted, batch)
    expect(result.map((n) => n.id)).toEqual(['new', 'a', 'old'])
    // 元の batch は破壊されない（コピーしてソートする）
    expect(batch.map((n) => n.id)).toEqual(['old', 'new'])
  })

  it('dedupes ids already present in sorted (fresh batch entry wins)', () => {
    const stale = makeNote('x', t(3))
    const fresh = makeNote('x', t(3))
    const result = insertIntoSorted([stale, makeNote('a', t(1))], [fresh])
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(fresh)
  })
})

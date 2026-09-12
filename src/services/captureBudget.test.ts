import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { captureTargets } from './captureBudget'

function note(id: string, accountId = 'a', renoteId?: string): NormalizedNote {
  return { id, _accountId: accountId, renoteId } as NormalizedNote
}

const keys = (m: Map<string, Set<string>>) =>
  [...m].flatMap(([acc, ids]) => [...ids].map((id) => `${acc}:${id}`))

describe('captureTargets', () => {
  it('本体と renote 元を同じアカウントの購読対象にする', () => {
    expect(keys(captureTargets([note('n1', 'a', 'r1')], 10))).toEqual([
      'a:n1',
      'a:r1',
    ])
  })

  it('予算は実際の購読数で数える (renote 元も 1 件)', () => {
    const notes = [note('n1', 'a', 'r1'), note('n2', 'a', 'r2')]
    // 予算 3: n1 + r1 で 2、n2 + r2 は収まらないので n2 ごと打ち切る
    expect(keys(captureTargets(notes, 3))).toEqual(['a:n1', 'a:r1'])
    expect(keys(captureTargets(notes, 4))).toHaveLength(4)
  })

  it('同じ renote 元を共有するノートは二重に数えない', () => {
    const notes = [note('n1', 'a', 'r1'), note('n2', 'a', 'r1')]
    expect(keys(captureTargets(notes, 3))).toEqual(['a:n1', 'a:r1', 'a:n2'])
  })

  it('アカウントが違えば同じ ID でも別の購読', () => {
    const notes = [note('n1', 'a'), note('n1', 'b')]
    expect(keys(captureTargets(notes, 2))).toEqual(['a:n1', 'b:n1'])
    expect(keys(captureTargets(notes, 1))).toEqual(['a:n1'])
  })

  it('予算 0 なら何も購読しない', () => {
    expect(captureTargets([note('n1')], 0).size).toBe(0)
  })
})

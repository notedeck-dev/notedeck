import { describe, expect, it } from 'vitest'
import type { NormalizedUser } from '@/adapters/types'
import { AppError } from '@/utils/errors'
import {
  classifyUserLookupError,
  groupUserHits,
  type UserLookupHit,
} from './userLookupResult'

function hit(
  accountId: string,
  accountHost: string,
  username: string,
  host: string | null,
): UserLookupHit {
  return {
    accountId,
    accountHost,
    user: { id: `${accountId}-${username}`, username, host } as NormalizedUser,
    relation: null,
  }
}

describe('groupUserHits (#1185)', () => {
  it('同じ acct は 1 枚に束ね、返った順を保つ', () => {
    const groups = groupUserHits([
      hit('acc-a', 'a.example', 'alice', 'b.example'),
      hit('acc-b', 'b.example', 'Alice', null),
      hit('acc-c', 'c.example', 'alice', 'B.example'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.acct).toBe('alice@b.example')
    expect(groups[0]?.primary.accountId).toBe('acc-a')
    expect(groups[0]?.hits.map((h) => h.accountId)).toEqual([
      'acc-a',
      'acc-b',
      'acc-c',
    ])
  })

  it('@user (host なし) で各サーバーの別人が返ればカードが分かれる', () => {
    const groups = groupUserHits([
      hit('acc-a', 'a.example', 'alice', null),
      hit('acc-b', 'b.example', 'alice', null),
    ])
    expect(groups.map((g) => g.acct)).toEqual([
      'alice@a.example',
      'alice@b.example',
    ])
  })
})

describe('classifyUserLookupError', () => {
  it('サーバーの 2 種のコードを見分け、他は failed', () => {
    expect(
      classifyUserLookupError(new AppError('API', 'x', 'NO_SUCH_USER')),
    ).toBe('notFound')
    expect(
      classifyUserLookupError(
        new AppError('API', 'x', 'FAILED_TO_RESOLVE_REMOTE_USER'),
      ),
    ).toBe('unresolved')
    expect(classifyUserLookupError(new Error('boom'))).toBe('failed')
    // Rust から届く直列化の形 (code / message / apiCode)
    expect(
      classifyUserLookupError({
        code: 'API',
        message: 'x',
        apiCode: 'NO_SUCH_USER',
      }),
    ).toBe('notFound')
  })
})

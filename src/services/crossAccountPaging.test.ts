import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import {
  type AccountCursor,
  advanceCursor,
  horizonOf,
  initialCursor,
  markFailed,
  nextHorizon,
  pickNextAccount,
  reseedFromRows,
  resetCursor,
} from './crossAccountPaging'

function n(id: string, createdAt: string, accountId = 'a'): NormalizedNote {
  return { id, createdAt, _accountId: accountId } as unknown as NormalizedNote
}
const T = (s: string) => `2026-10-${s}T00:00:00.000Z`

describe('crossAccountPaging: カーソル', () => {
  it('生ページの最古で前進し、空ページで尽きる', () => {
    let c = initialCursor('a')
    expect(c.oldest).toBeNull()
    c = advanceCursor(c, [n('x', T('17')), n('y', T('15')), n('z', T('16'))])
    expect(c.oldest).toEqual({ id: 'y', createdAt: T('15') })
    expect(c.exhausted).toBe(false)
    c = advanceCursor(c, [])
    expect(c.exhausted).toBe(true)
  })

  it('最新側のページでは戻らない (単調前進)', () => {
    let c = advanceCursor(initialCursor('a'), [n('y', T('15'))])
    c = advanceCursor(c, [n('w', T('18'))])
    expect(c.oldest?.id).toBe('y')
  })

  it('取り直し (reset) はページの最古に置き直し、失敗と尽きた状態を消す', () => {
    let c = advanceCursor(initialCursor('a'), [n('y', T('05'))])
    c = markFailed(c, 1000)
    c = advanceCursor(c, [])
    c = resetCursor(c, [n('w', T('18')), n('v', T('17'))])
    expect(c.oldest?.id).toBe('v')
    expect(c.exhausted).toBe(false)
    expect(c.failures).toBe(0)
    expect(c.nextRetryAt).toBe(0)
  })

  it('失敗は指数バックオフ (1s → 2s → 4s … 60s 上限)、成功で解除', () => {
    let c = initialCursor('a')
    c = markFailed(c, 0)
    expect(c.nextRetryAt).toBe(1000)
    c = markFailed(c, 0)
    expect(c.nextRetryAt).toBe(2000)
    c = markFailed(c, 0)
    expect(c.nextRetryAt).toBe(4000)
    for (let i = 0; i < 10; i++) c = markFailed(c, 0)
    expect(c.nextRetryAt).toBe(60_000)
    c = advanceCursor(c, [n('y', T('15'))])
    expect(c.failures).toBe(0)
    expect(c.nextRetryAt).toBe(0)
  })

  it('reseed: 列に残った行があればその最古、無ければ生ページの最古を保つ', () => {
    const c = advanceCursor(initialCursor('a'), [n('y', T('05'))])
    expect(
      reseedFromRows(c, [n('p', T('12')), n('q', T('10'))]).oldest?.id,
    ).toBe('q')
    expect(reseedFromRows(c, []).oldest?.id).toBe('y')
  })
})

describe('crossAccountPaging: 水平線', () => {
  const dense = (): AccountCursor =>
    advanceCursor(initialCursor('dense'), [
      n('d1', T('17'), 'dense'),
      n('d2', T('16'), 'dense'),
    ])
  const sparse = (): AccountCursor =>
    advanceCursor(initialCursor('sparse'), [
      n('s1', T('17'), 'sparse'),
      n('s2', T('01'), 'sparse'),
    ])
  const cursors = (): AccountCursor[] => [dense(), sparse()]

  it('まだ遡れるアカウントのうち最古行がいちばん新しいものが水平線', () => {
    expect(horizonOf(cursors())).toBe(T('16'))
  })

  it('尽きたアカウントは水平線に参加しない。全員尽きたら制限なし', () => {
    expect(horizonOf([advanceCursor(dense(), []), sparse()])).toBe(T('01'))
    expect(
      horizonOf([advanceCursor(dense(), []), advanceCursor(sparse(), [])]),
    ).toBeNull()
  })

  it('1 ページも取れていない (oldest 無し) アカウントは水平線を決めない', () => {
    expect(horizonOf([dense(), sparse(), initialCursor('new')])).toBe(T('16'))
  })

  it('失敗中のアカウントも水平線に残る (#1184 の決定)', () => {
    expect(horizonOf([markFailed(dense(), 0), sparse()])).toBe(T('16'))
  })

  it('水平線は単調に下がるだけ。全員尽きたら制限なしに開く', () => {
    expect(
      nextHorizon(T('16'), [
        advanceCursor(initialCursor('a'), [n('x', T('18'))]),
      ]),
    ).toBe(T('16'))
    expect(
      nextHorizon(T('16'), [
        advanceCursor(initialCursor('a'), [n('x', T('10'))]),
      ]),
    ).toBe(T('10'))
    expect(nextHorizon(null, cursors())).toBe(T('16'))
    expect(
      nextHorizon(T('16'), [advanceCursor(initialCursor('a'), [])]),
    ).toBeNull()
  })
})

describe('crossAccountPaging: 次に取るアカウント', () => {
  it('水平線を決めているアカウントを 1 つ選ぶ', () => {
    const [dense, sparse] = [
      advanceCursor(initialCursor('dense'), [n('d2', T('16'), 'dense')]),
      advanceCursor(initialCursor('sparse'), [n('s2', T('01'), 'sparse')]),
    ]
    expect(pickNextAccount([sparse, dense], 0)).toBe('dense')
  })

  it('1 ページも無いアカウントがあればそれを先に取る', () => {
    const dense = advanceCursor(initialCursor('dense'), [
      n('d2', T('16'), 'dense'),
    ])
    expect(pickNextAccount([dense, initialCursor('new')], 0)).toBe('new')
  })

  it('水平線のアカウントがバックオフ中なら何も取らない (他のアカウントで底を掘り進めない)', () => {
    const dense = markFailed(
      advanceCursor(initialCursor('dense'), [n('d2', T('16'), 'dense')]),
      1000,
    )
    const sparse = advanceCursor(initialCursor('sparse'), [
      n('s2', T('01'), 'sparse'),
    ])
    expect(pickNextAccount([dense, sparse], 1500)).toBeNull()
    expect(pickNextAccount([dense, sparse], 2000)).toBe('dense')
  })

  it('尽きたアカウントは選ばない。全員尽きたら null', () => {
    const dense = advanceCursor(
      advanceCursor(initialCursor('dense'), [n('d2', T('16'), 'dense')]),
      [],
    )
    const sparse = advanceCursor(initialCursor('sparse'), [
      n('s2', T('01'), 'sparse'),
    ])
    expect(pickNextAccount([dense, sparse], 0)).toBe('sparse')
    expect(pickNextAccount([dense, advanceCursor(sparse, [])], 0)).toBeNull()
  })
})

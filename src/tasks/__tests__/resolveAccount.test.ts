import { describe, expect, it } from 'vitest'

import { resolveTaskAccount } from '@/tasks/resolveAccount'

const a1 = { id: 'a1', host: 'yami.ski', hasToken: true }
const a2 = { id: 'a2', host: 'misskey.cloud', hasToken: false }
const guest = { id: 'g1', host: 'misskey.io', hasToken: false }

describe('resolveTaskAccount', () => {
  it('明示 id があれば一致するアカウントを返す', () => {
    const r = resolveTaskAccount([a1, a2], null, 'a2')
    expect(r).toEqual({ ok: true, id: 'a2', host: 'misskey.cloud' })
  })

  it('明示 id が見つからなければ not-found (フォールバックしない)', () => {
    const r = resolveTaskAccount([a1], a1, 'gone')
    expect(r).toEqual({ ok: false, reason: 'not-found', requestedId: 'gone' })
  })

  it('明示 id なしはアクティブアカウントを優先する', () => {
    const r = resolveTaskAccount([a1, a2], a2, undefined)
    expect(r).toEqual({ ok: true, id: 'a2', host: 'misskey.cloud' })
  })

  it('アクティブなしはトークン保持アカウントへフォールバックする', () => {
    const r = resolveTaskAccount([guest, a1], null, null)
    expect(r).toEqual({ ok: true, id: 'a1', host: 'yami.ski' })
  })

  it('利用可能なアカウントが無ければ no-account', () => {
    const r = resolveTaskAccount([guest], null, undefined)
    // guest は hasToken=false だが activeAccount 経由なら使える設計のため、
    // fallback 探索では対象外
    expect(r).toEqual({ ok: false, reason: 'no-account' })
  })
})

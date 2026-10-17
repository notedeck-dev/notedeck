import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiGetUserPolicies = vi.fn()

vi.mock('@/utils/tauriInvoke', () => ({
  commands: {
    apiGetUserPolicies: (id: string) => apiGetUserPolicies(id),
  },
  unwrap: (x: unknown) => {
    const r = x as { status: string; data?: unknown; error?: unknown }
    if (r.status === 'error') throw r.error
    return r.data
  },
}))

vi.mock('@/i18n', () => ({
  i18n: { ts: { _postFormConstants: { publicNonLtl: 'パブリック (非LTL)' } } },
}))

import type { NormalizedNote } from '../types'
import {
  canPostSemiPublic,
  canPostSemiPublicFor,
  clearSemiPublicCache,
  effectivePostVisibility,
  narrowerVisibility,
  renoteVisibilityFor,
  semiPublicReplyDefault,
} from './semiPublic'

function note(over: Partial<NormalizedNote>): NormalizedNote {
  return {
    id: 'n1',
    _accountId: 'acc-1',
    visibility: 'public',
    user: { id: 'u-other' },
    ...over,
  } as unknown as NormalizedNote
}

describe('canPostSemiPublic', () => {
  it('ポリシーが true のときだけ投稿できる (キー無し = 本家、false = 権限無し)', () => {
    expect(canPostSemiPublic({ canPublicNonLtlNote: true })).toBe(true)
    expect(canPostSemiPublic({ canPublicNonLtlNote: false })).toBe(false)
    expect(canPostSemiPublic({ canPublicNote: true })).toBe(false)
    expect(canPostSemiPublic(undefined)).toBe(false)
  })
})

describe('effectivePostVisibility', () => {
  it('public かつ dontShowOnLtl なら public_non_ltl、それ以外は受信値のまま', () => {
    expect(
      effectivePostVisibility(
        note({ visibility: 'public', dontShowOnLtl: true }),
      ),
    ).toBe('public_non_ltl')
    expect(
      effectivePostVisibility(
        note({ visibility: 'public', dontShowOnLtl: false }),
      ),
    ).toBe('public')
    expect(effectivePostVisibility(note({ visibility: 'public' }))).toBe(
      'public',
    )
    expect(
      effectivePostVisibility(
        note({ visibility: 'home', dontShowOnLtl: true }),
      ),
    ).toBe('home')
  })
})

describe('narrowerVisibility', () => {
  it('specified > followers > home > public_non_ltl > public の順で狭い方を取る', () => {
    expect(narrowerVisibility('public', 'public_non_ltl')).toBe(
      'public_non_ltl',
    )
    expect(narrowerVisibility('public_non_ltl', 'home')).toBe('home')
    expect(narrowerVisibility('followers', 'public_non_ltl')).toBe('followers')
    expect(narrowerVisibility('public_non_ltl', 'specified')).toBe('specified')
    expect(narrowerVisibility('public', 'public')).toBe('public')
  })
})

describe('semiPublicReplyDefault', () => {
  const semi = note({ id: 'p', visibility: 'public', dontShowOnLtl: true })

  it('返信先がセミパブリックで投稿できるなら public_non_ltl', () => {
    expect(semiPublicReplyDefault(semi, 'me', true)).toBe('public_non_ltl')
  })

  it('投稿できないアカウントでは null (従来の既定に任せる)', () => {
    expect(semiPublicReplyDefault(semi, 'me', false)).toBeNull()
  })

  it('自分のセミパブリックへのパブリック返信に返すときも public_non_ltl', () => {
    const mine = note({
      id: 'root',
      visibility: 'public',
      dontShowOnLtl: true,
      user: { id: 'me' } as NormalizedNote['user'],
    })
    const publicReply = note({ id: 'child', visibility: 'public', reply: mine })
    expect(semiPublicReplyDefault(publicReply, 'me', true)).toBe(
      'public_non_ltl',
    )
  })

  it('他人のセミパブリックへのパブリック返信に返すときは null', () => {
    const theirs = note({
      id: 'root',
      visibility: 'public',
      dontShowOnLtl: true,
    })
    const publicReply = note({
      id: 'child',
      visibility: 'public',
      reply: theirs,
    })
    expect(semiPublicReplyDefault(publicReply, 'me', true)).toBeNull()
  })

  it('返信先が普通の public なら null', () => {
    expect(
      semiPublicReplyDefault(note({ visibility: 'public' }), 'me', true),
    ).toBeNull()
  })
})

describe('canPostSemiPublicFor / renoteVisibilityFor', () => {
  beforeEach(() => {
    apiGetUserPolicies.mockReset()
    clearSemiPublicCache()
  })

  it('アカウントのポリシーを 1 回だけ取ってメモ化する', async () => {
    apiGetUserPolicies.mockResolvedValue({
      status: 'ok',
      data: { canPublicNonLtlNote: true },
    })
    expect(await canPostSemiPublicFor('acc-1')).toBe(true)
    expect(await canPostSemiPublicFor('acc-1')).toBe(true)
    expect(apiGetUserPolicies).toHaveBeenCalledTimes(1)
  })

  it('取得に失敗したら false で、次回は取り直す', async () => {
    apiGetUserPolicies.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'NETWORK' },
    })
    expect(await canPostSemiPublicFor('acc-1')).toBe(false)
    apiGetUserPolicies.mockResolvedValueOnce({
      status: 'ok',
      data: { canPublicNonLtlNote: true },
    })
    expect(await canPostSemiPublicFor('acc-1')).toBe(true)
  })

  it('素のリノート: 元がセミパブリックで同じアカウントが投稿できるなら public_non_ltl', async () => {
    apiGetUserPolicies.mockResolvedValue({
      status: 'ok',
      data: { canPublicNonLtlNote: true },
    })
    const semi = note({ visibility: 'public', dontShowOnLtl: true })
    expect(await renoteVisibilityFor(semi, 'acc-1')).toBe('public_non_ltl')
  })

  it('素のリノート: 普通の public ならポリシーを見ずに undefined (サーバー既定)', async () => {
    expect(
      await renoteVisibilityFor(note({ visibility: 'public' }), 'acc-1'),
    ).toBeUndefined()
    expect(apiGetUserPolicies).not.toHaveBeenCalled()
  })

  it('素のリノート: 別アカウントでのリノートはセミパブリックを引き継がない', async () => {
    const semi = note({ visibility: 'public', dontShowOnLtl: true })
    expect(await renoteVisibilityFor(semi, 'acc-2')).toBeUndefined()
    expect(apiGetUserPolicies).not.toHaveBeenCalled()
  })

  it('素のリノート: 投稿できないアカウントでは undefined', async () => {
    apiGetUserPolicies.mockResolvedValue({
      status: 'ok',
      data: { canPublicNonLtlNote: false },
    })
    const semi = note({ visibility: 'public', dontShowOnLtl: true })
    expect(await renoteVisibilityFor(semi, 'acc-1')).toBeUndefined()
  })
})

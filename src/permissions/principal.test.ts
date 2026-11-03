import { describe, expect, it } from 'vitest'
import {
  externalTokenPrincipal,
  memoAuthorDisplayName,
  principalActorLabel,
  principalAuthorId,
  principalForRecord,
} from './principal'

describe('memoAuthorDisplayName (#135)', () => {
  it('principal の著者は id から表示言語の表示名を組み直す', () => {
    expect(
      memoAuthorDisplayName({
        id: 'plugin:widget:clock',
        displayName: 'Widget "clock"',
      }),
    ).toBe('ウィジェット「clock」')
    expect(
      memoAuthorDisplayName({ id: 'scratchpad', displayName: 'Scratchpad' }),
    ).toBe('スクラッチパッド')
    expect(memoAuthorDisplayName({ id: 'ai.chat', displayName: 'AI' })).toBe(
      'AI',
    )
  })

  it('persona (skill:) などそれ以外の著者は保存された表示名のまま', () => {
    expect(memoAuthorDisplayName({ id: 'skill:yui', displayName: '唯' })).toBe(
      '唯',
    )
  })
})

describe('外部トークンの帰属 (#1292)', () => {
  it('実行要求のトークンの正体から principal を組み、無ければ素の external', () => {
    const p = externalTokenPrincipal({
      id: 't1',
      name: 'Raycast',
      scope: { preset: 'readonly' },
    })
    expect(p).toMatchObject({
      kind: 'external',
      tokenId: 't1',
      tokenName: 'Raycast',
    })
    expect(p.kind === 'external' && p.tokenScope?.preset).toBe('readonly')
    expect(externalTokenPrincipal(null)).toEqual({ kind: 'external' })
    expect(externalTokenPrincipal({ name: 'x' })).toEqual({ kind: 'external' })
  })

  it('ラベルと著者はトークン名 / id で出し、名前の無いものは従来の「外部アプリ」', () => {
    const named = externalTokenPrincipal({ id: 't1', name: 'Raycast' })
    expect(principalActorLabel(named)).toBe('外部アプリ「Raycast」')
    expect(principalAuthorId(named)).toBe('token:t1')
    expect(principalActorLabel({ kind: 'external' })).toBe('外部アプリ')
    expect(principalAuthorId({ kind: 'external' })).toBe('external')
    expect(
      memoAuthorDisplayName({ id: 'token:t1', displayName: 'Raycast' }),
    ).toBe('外部アプリ「Raycast」')
  })

  it('記録用の形は scope を落とす', () => {
    const p = externalTokenPrincipal({
      id: 't1',
      name: 'Raycast',
      scope: { preset: 'full' },
    })
    expect(principalForRecord(p)).toEqual({
      kind: 'external',
      tokenId: 't1',
      tokenName: 'Raycast',
    })
    expect(principalForRecord({ kind: 'ai.chat' })).toEqual({ kind: 'ai.chat' })
  })
})

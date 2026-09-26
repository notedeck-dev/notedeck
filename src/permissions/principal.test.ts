import { describe, expect, it } from 'vitest'
import { memoAuthorDisplayName } from './principal'

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

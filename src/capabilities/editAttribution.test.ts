import { describe, expect, it } from 'vitest'
import { editAttribution } from './editAttribution'

describe('editAttribution', () => {
  it('principal と理由を編集履歴の帰属にする', () => {
    expect(
      editAttribution(
        { principal: { kind: 'ai.chat' } },
        { reason: 'フック名の乖離を直すため' },
      ),
    ).toEqual({
      by: { kind: 'ai.chat' },
      reason: 'フック名の乖離を直すため',
    })
  })

  it('理由が無ければ欄を作らない (空欄を履歴に並べない)', () => {
    expect(editAttribution({ principal: { kind: 'user' } }, {})).toEqual({
      by: { kind: 'user' },
    })
    expect(
      editAttribution({ principal: { kind: 'user' } }, { reason: '   ' }),
    ).toEqual({ by: { kind: 'user' } })
  })

  it('理由の前後の空白は落とす', () => {
    expect(
      editAttribution({ principal: { kind: 'ai.chat' } }, { reason: ' 理由 ' })
        ?.reason,
    ).toBe('理由')
  })

  it('文字列でない理由は無視する', () => {
    expect(
      editAttribution({ principal: { kind: 'ai.chat' } }, { reason: 42 }),
    ).toEqual({ by: { kind: 'ai.chat' } })
  })

  it('principal が無い経路 (dispatcher を通らない実行) では帰属を作らない', () => {
    expect(editAttribution(undefined, { reason: '理由' })).toBeUndefined()
    expect(editAttribution({}, { reason: '理由' })).toBeUndefined()
  })
})

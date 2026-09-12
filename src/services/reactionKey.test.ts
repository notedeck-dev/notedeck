import { describe, expect, it } from 'vitest'
import { canonicalReactionKey, wireReaction } from './reactionKey'

describe('canonicalReactionKey', () => {
  it('ローカル絵文字の 2 表記 (:name: / :name@.:) を取得元 host 付きの同じキーに写す', () => {
    expect(canonicalReactionKey(':blob:', 'a.example')).toBe('blob@a.example')
    expect(canonicalReactionKey(':blob@.:', 'a.example')).toBe('blob@a.example')
  })

  it('別サーバーから見た同じ絵文字と一致する', () => {
    // サーバー A の絵文字を A で見ると :blob@.:、B で見ると :blob@a.example:
    expect(canonicalReactionKey(':blob@.:', 'A.Example')).toBe(
      canonicalReactionKey(':blob@a.example:', 'b.example'),
    )
  })

  it('同名でもサーバーが違えば別絵文字', () => {
    expect(canonicalReactionKey(':blob:', 'a.example')).not.toBe(
      canonicalReactionKey(':blob:', 'b.example'),
    )
  })

  it('Unicode 絵文字は FE0F を剥がすが ZWJ シーケンスは触らない (本家と同じ)', () => {
    expect(canonicalReactionKey('❤️', 'a.example')).toBe('❤')
    expect(canonicalReactionKey('👨‍👩‍👧', 'a.example')).toBe('👨‍👩‍👧')
    expect(canonicalReactionKey('👍🏽', 'a.example')).toBe('👍🏽')
  })
})

describe('wireReaction', () => {
  it('主ビューのサーバー自身の絵文字なら :name:、他サーバーなら :name@host:', () => {
    expect(
      wireReaction(canonicalReactionKey(':blob:', 'a.example'), 'a.example'),
    ).toBe(':blob:')
    expect(
      wireReaction(canonicalReactionKey(':blob:', 'b.example'), 'a.example'),
    ).toBe(':blob@b.example:')
  })

  it('Unicode はそのまま', () => {
    expect(
      wireReaction(canonicalReactionKey('👍', 'a.example'), 'a.example'),
    ).toBe('👍')
  })
})

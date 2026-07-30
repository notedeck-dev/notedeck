import { describe, expect, it } from 'vitest'
import { reactionJoinability } from './remoteReaction'

const HOST = 'example.com'

function joinability(
  reaction: string,
  opts: { remote?: boolean; hasEmojiUrl?: boolean } = {},
) {
  return reactionJoinability(reaction, {
    serverHost: HOST,
    remoteEmojiReactions: opts.remote ?? false,
    hasEmojiUrl: opts.hasEmojiUrl ?? true,
  })
}

describe('reactionJoinability', () => {
  it('Unicode 絵文字は常に押せる', () => {
    expect(joinability('❤')).toBe('ok')
    expect(joinability('👍')).toBe('ok')
  })

  it('ローカルカスタム絵文字は常に押せる', () => {
    expect(joinability(':foo:')).toBe('ok')
    expect(joinability(':foo@.:')).toBe('ok')
  })

  it('自サーバーのホストが付いていてもローカル扱い', () => {
    expect(joinability(`:foo@${HOST}:`)).toBe('ok')
    expect(joinability(':foo@Example.COM:')).toBe('ok')
  })

  it('非対応サーバーではリモート絵文字に相乗りできない', () => {
    expect(joinability(':foo@remote.example:')).toBe('unsupported-server')
  })

  it('対応サーバーでは絵文字が解決できれば相乗りできる', () => {
    expect(joinability(':foo@remote.example:', { remote: true })).toBe('ok')
  })

  it('対応サーバーでも絵文字が解決できなければ押せない', () => {
    expect(
      joinability(':foo@remote.example:', { remote: true, hasEmojiUrl: false }),
    ).toBe('emoji-unavailable')
  })

  it('カスタム絵文字として解釈できない文字列は判定対象外 (挙動を変えない)', () => {
    expect(joinability(':foo')).toBe('ok')
    expect(joinability('foo')).toBe('ok')
    expect(joinability('')).toBe('ok')
    // 記号入りは本家のカスタム絵文字名の文法から外れる
    expect(joinability(':foo bar@remote.example:')).toBe('ok')
  })
})

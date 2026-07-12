import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { buildReplyMentions } from './replyMentions'

function replyTarget(
  partial: Omit<Partial<NormalizedNote>, 'user'> & {
    user?: Partial<NormalizedNote['user']>
  } = {},
): NormalizedNote {
  return {
    id: 'n1',
    _accountId: 'acc-1',
    _serverHost: 'misskey.example',
    createdAt: '2026-07-01T00:00:00.000Z',
    text: null,
    cw: null,
    visibility: 'public',
    emojis: {},
    reactionEmojis: {},
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    files: [],
    ...partial,
    user: {
      id: 'u-alice',
      username: 'alice',
      host: null,
      name: null,
      avatarUrl: null,
      ...partial.user,
    },
  }
}

const me = { userId: 'u-me', username: 'me', host: 'misskey.example' }

describe('buildReplyMentions', () => {
  it('リプライ先ユーザーへのメンションを先頭に付ける (ローカルは host なし)', () => {
    expect(buildReplyMentions(replyTarget(), me)).toEqual(['@alice'])
  })

  it('リモートユーザーは @user@host 形式', () => {
    const target = replyTarget({ user: { host: 'remote.example' } })
    expect(buildReplyMentions(target, me)).toEqual(['@alice@remote.example'])
  })

  it('自分自身へのリプライではメンションを付けない', () => {
    const target = replyTarget({ user: { id: 'u-me', username: 'me' } })
    expect(buildReplyMentions(target, me)).toEqual([])
  })

  it('リプライ先本文中のメンション (会話参加者) を重複なしで引き継ぐ', () => {
    const target = replyTarget({
      text: '@bob @carol@remote.example @alice こんにちは',
    })
    expect(buildReplyMentions(target, me)).toEqual([
      '@alice',
      '@bob',
      '@carol@remote.example',
    ])
  })

  it('本文中の自分へのメンションは引き継がない (ローカル/リモート表記の両方)', () => {
    const target = replyTarget({
      text: '@me @me@misskey.example @bob やあ',
    })
    expect(buildReplyMentions(target, me)).toEqual(['@alice', '@bob'])
  })

  it('大文字小文字違いは同一メンションとして dedup する', () => {
    const target = replyTarget({ text: '@Alice @BOB @bob' })
    expect(buildReplyMentions(target, me)).toEqual(['@alice', '@BOB'])
  })

  it('自分のアカウント情報が無くても成立する', () => {
    expect(buildReplyMentions(replyTarget(), null)).toEqual(['@alice'])
  })
})

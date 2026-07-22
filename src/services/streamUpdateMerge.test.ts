import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NormalizedNote } from '@/adapters/types'
import {
  createUpdateDeduper,
  mergeChatUpdate,
  mergeNoteUpdate,
} from '@/services/streamUpdateMerge'

function makeNote(partial: Partial<NormalizedNote> = {}): NormalizedNote {
  return {
    id: 'n1',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: 'hello',
    user: {
      id: 'u-author',
      username: 'author',
      name: 'Author',
      host: null,
      avatarUrl: null,
    },
    reactions: {},
    reactionEmojis: {},
    myReaction: null,
    renoteCount: 0,
    repliesCount: 0,
    visibility: 'public',
    ...partial,
  } as NormalizedNote
}

describe('mergeNoteUpdate', () => {
  it('reacted はカウントを加算する', () => {
    const note = makeNote({ reactions: { '👍': 1 } })
    const merged = mergeNoteUpdate(
      note,
      { type: 'reacted', noteId: 'n1', body: { userId: 'u2', reaction: '👍' } },
      'me',
    )
    expect(merged?.reactions['👍']).toBe(2)
    // 元オブジェクトは不変
    expect(note.reactions['👍']).toBe(1)
  })

  it('自ユーザの reacted は無視する (楽観的更新と二重加算しない)', () => {
    const note = makeNote()
    const merged = mergeNoteUpdate(
      note,
      { type: 'reacted', noteId: 'n1', body: { userId: 'me', reaction: '👍' } },
      'me',
    )
    expect(merged).toBeNull()
  })

  it('カスタム絵文字はコロンを剥がして reactionEmojis に記録する', () => {
    const note = makeNote()
    const merged = mergeNoteUpdate(
      note,
      {
        type: 'reacted',
        noteId: 'n1',
        body: {
          userId: 'u2',
          reaction: ':blobcat:',
          emoji: { name: 'blobcat', url: 'https://x/blob.png' },
        },
      },
      'me',
    )
    expect(merged?.reactions[':blobcat:']).toBe(1)
    expect(merged?.reactionEmojis.blobcat).toBe('https://x/blob.png')
  })

  it('emoji が文字列 URL の場合もそのまま記録する', () => {
    const merged = mergeNoteUpdate(
      makeNote(),
      {
        type: 'reacted',
        noteId: 'n1',
        body: { userId: 'u2', reaction: ':cat:', emoji: 'https://x/cat.png' },
      },
      'me',
    )
    expect(merged?.reactionEmojis.cat).toBe('https://x/cat.png')
  })

  it('unreacted は減算し 0 でキーごと消す', () => {
    const note = makeNote({ reactions: { '👍': 1, '🎉': 2 } })
    const merged = mergeNoteUpdate(
      note,
      {
        type: 'unreacted',
        noteId: 'n1',
        body: { userId: 'u2', reaction: '👍' },
      },
      'me',
    )
    expect(merged?.reactions['👍']).toBeUndefined()
    expect(merged?.reactions['🎉']).toBe(2)
  })

  it('自ユーザの unreacted は無視する', () => {
    const merged = mergeNoteUpdate(
      makeNote({ reactions: { '👍': 1 } }),
      {
        type: 'unreacted',
        noteId: 'n1',
        body: { userId: 'me', reaction: '👍' },
      },
      'me',
    )
    expect(merged).toBeNull()
  })

  it('pollVoted は該当 choice の票を増やし、自分の投票なら isVoted を立てる', () => {
    const note = makeNote({
      poll: {
        multiple: false,
        expiresAt: null,
        choices: [
          { text: 'A', votes: 1, isVoted: false },
          { text: 'B', votes: 0, isVoted: false },
        ],
      },
    })
    const other = mergeNoteUpdate(
      note,
      { type: 'pollVoted', noteId: 'n1', body: { userId: 'u2', choice: 1 } },
      'me',
    )
    expect(other?.poll?.choices[1]?.votes).toBe(1)
    expect(other?.poll?.choices[1]?.isVoted).toBe(false)

    const mine = mergeNoteUpdate(
      note,
      { type: 'pollVoted', noteId: 'n1', body: { userId: 'me', choice: 0 } },
      'me',
    )
    expect(mine?.poll?.choices[0]?.votes).toBe(2)
    expect(mine?.poll?.choices[0]?.isVoted).toBe(true)
  })

  it('poll の無いノートへの pollVoted は no-op (null)', () => {
    const merged = mergeNoteUpdate(
      makeNote(),
      { type: 'pollVoted', noteId: 'n1', body: { userId: 'u2', choice: 0 } },
      'me',
    )
    expect(merged).toBeNull()
  })
})

describe('mergeChatUpdate', () => {
  const msg = {
    id: 'm1',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: 'hi',
    reactions: [
      { user: { id: 'u1', username: 'a' }, reaction: '👍' },
      { user: null, reaction: '👍' },
    ],
    // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 ChatMessage
  } as any

  it('reacted は reactor の null フィールドを undefined に正規化して追加する', () => {
    const merged = mergeChatUpdate(msg, {
      type: 'reacted',
      messageId: 'm1',
      userId: 'u2',
      reaction: '🎉',
      reactor: {
        id: 'u2',
        username: 'b',
        name: null,
        host: null,
        avatarUrl: 'https://x/a.png',
      },
    })
    const added = merged?.reactions?.at(-1)
    expect(added?.reaction).toBe('🎉')
    expect(added?.user?.name).toBeUndefined()
    expect(added?.user?.host).toBeUndefined()
    expect(added?.user?.avatarUrl).toBe('https://x/a.png')
  })

  it('unreacted は (userId, reaction) 一致の最初の 1 件だけ削除する', () => {
    const merged = mergeChatUpdate(msg, {
      type: 'unreacted',
      messageId: 'm1',
      userId: 'u1',
      reaction: '👍',
    })
    expect(merged?.reactions).toHaveLength(1)
    expect(merged?.reactions?.[0]?.user).toBeNull()
  })

  it('unreacted は userId 無し ↔ user null をマッチさせる', () => {
    const merged = mergeChatUpdate(msg, {
      type: 'unreacted',
      messageId: 'm1',
      reaction: '👍',
    })
    expect(merged?.reactions).toHaveLength(1)
    expect(merged?.reactions?.[0]?.user?.id).toBe('u1')
  })

  it('一致しない unreacted は no-op (null)', () => {
    const merged = mergeChatUpdate(msg, {
      type: 'unreacted',
      messageId: 'm1',
      userId: 'u9',
      reaction: '💀',
    })
    expect(merged).toBeNull()
  })
})

describe('createUpdateDeduper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('同一 (id, sig) は窓内で 1 回だけ通す', () => {
    const dedup = createUpdateDeduper(1000)
    expect(dedup.shouldApply('n1', 'sig-a')).toBe(true)
    expect(dedup.shouldApply('n1', 'sig-a')).toBe(false)
    // 別 sig は通る (react→unreact の逐次操作)
    expect(dedup.shouldApply('n1', 'sig-b')).toBe(true)
    // 別 id は独立
    expect(dedup.shouldApply('n2', 'sig-a')).toBe(true)
  })

  it('窓が過ぎたら同一 sig を再度通す', () => {
    const dedup = createUpdateDeduper(1000)
    expect(dedup.shouldApply('n1', 'sig-a')).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(dedup.shouldApply('n1', 'sig-a')).toBe(true)
  })
})

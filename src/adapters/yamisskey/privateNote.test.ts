import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({
  i18n: { ts: { _postFormConstants: { private: 'プライベート' } } },
}))

import type { NormalizedNote } from '../types'
import {
  isPrivateNote,
  privateReplyDefault,
  toPostVisibility,
} from './privateNote'

function note(over: Partial<NormalizedNote>): NormalizedNote {
  return {
    id: 'n1',
    visibility: 'specified',
    user: { id: 'author' },
    visibleUserIds: [],
    ...over,
  } as unknown as NormalizedNote
}

describe('isPrivateNote', () => {
  it('ダイレクトで宛先が空ならプライベート', () => {
    expect(isPrivateNote(note({ visibleUserIds: [] }))).toBe(true)
    expect(isPrivateNote(note({ visibleUserIds: undefined }))).toBe(true)
  })

  it('ダイレクトで宛先が投稿者自身だけでもプライベート (自分への返信連鎖)', () => {
    expect(isPrivateNote(note({ visibleUserIds: ['author'] }))).toBe(true)
  })

  it('他人が宛先にいればプライベートではない', () => {
    expect(isPrivateNote(note({ visibleUserIds: ['someone'] }))).toBe(false)
    expect(isPrivateNote(note({ visibleUserIds: ['author', 'someone'] }))).toBe(
      false,
    )
  })

  it('ダイレクト以外はプライベートではない', () => {
    expect(isPrivateNote(note({ visibility: 'public' }))).toBe(false)
    expect(
      isPrivateNote(note({ visibility: 'followers', visibleUserIds: [] })),
    ).toBe(false)
  })
})

describe('toPostVisibility', () => {
  it('プライベートはダイレクト + ローカルのみに変換し、それ以外は素通し', () => {
    expect(toPostVisibility('private', false)).toEqual({
      visibility: 'specified',
      localOnly: true,
    })
    expect(toPostVisibility('specified', true)).toEqual({
      visibility: 'specified',
      localOnly: false,
    })
    expect(toPostVisibility('home', true)).toEqual({
      visibility: 'home',
      localOnly: true,
    })
    expect(toPostVisibility('public', false)).toEqual({
      visibility: 'public',
      localOnly: false,
    })
  })
})

describe('privateReplyDefault', () => {
  it('返信先がプライベートで、選べるアカウントなら private', () => {
    expect(privateReplyDefault(note({}), true)).toBe('private')
  })

  it('選べないアカウントでは null (従来の既定に任せる)', () => {
    expect(privateReplyDefault(note({}), false)).toBeNull()
  })

  it('返信先が普通のダイレクトなら null', () => {
    expect(
      privateReplyDefault(note({ visibleUserIds: ['someone'] }), true),
    ).toBeNull()
  })
})

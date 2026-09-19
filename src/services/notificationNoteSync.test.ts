import { describe, expect, it } from 'vitest'

import type { NormalizedNote, NormalizedNotification } from '@/adapters/types'
import {
  dropDeletedNote,
  syncNotificationNotes,
} from '@/services/notificationNoteSync'

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

function makeNotif(note?: NormalizedNote): NormalizedNotification {
  return {
    id: 'notif1',
    _accountId: 'acc1',
    _serverHost: 'example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    type: 'reaction',
    note,
  }
}

describe('syncNotificationNotes', () => {
  it('store の最新オブジェクトへ差し替える', () => {
    const notif = makeNotif(makeNote())
    const latest = makeNote({ reactions: { '👍': 1 } })

    const result = syncNotificationNotes([notif], (_accountId, id) =>
      id === 'n1' ? latest : undefined,
    )

    expect(result[0]?.note).toBe(latest)
  })

  it('pure renote 経由でリアクションされた内側ノートも差し替える', () => {
    const inner = makeNote({ id: 'inner', text: 'original' })
    const outer = makeNote({
      id: 'outer',
      text: null,
      renoteId: 'inner',
      renote: inner,
    })
    const notif = makeNotif(outer)
    // MkNote は pure renote の内側ノートを emit するので、noteStore は
    // 内側の id で更新される (外側 'outer' は store に無い)
    const latestInner = makeNote({
      id: 'inner',
      text: 'original',
      reactions: { '👍': 1 },
    })

    const result = syncNotificationNotes([notif], (_accountId, id) =>
      id === 'inner' ? latestInner : undefined,
    )

    expect(result[0]?.note?.renote).toBe(latestInner)
    expect(result[0]?.note?.id).toBe('outer')
  })

  it('変化が無ければ同一オブジェクトを返す (無駄な再描画を避ける)', () => {
    const note = makeNote()
    const notif = makeNotif(note)

    const result = syncNotificationNotes([notif], (_accountId, id) =>
      id === 'n1' ? note : undefined,
    )

    expect(result[0]).toBe(notif)
  })

  it('note を持たない通知 (フォロー等) はそのまま通す', () => {
    const notif = makeNotif(undefined)

    const result = syncNotificationNotes([notif], () => undefined)

    expect(result[0]).toBe(notif)
  })

  it('外側が一致する場合は内側を見ない (二重差し替えしない)', () => {
    const inner = makeNote({ id: 'inner' })
    const outer = makeNote({
      id: 'outer',
      text: null,
      renoteId: 'inner',
      renote: inner,
    })
    const notif = makeNotif(outer)
    const latestOuter = makeNote({
      id: 'outer',
      text: null,
      renoteId: 'inner',
      renote: inner,
      reactions: { '👍': 1 },
    })

    const result = syncNotificationNotes([notif], (_accountId, id) =>
      id === 'outer' ? latestOuter : makeNote({ id: 'unexpected' }),
    )

    expect(result[0]?.note).toBe(latestOuter)
  })
})

describe('dropDeletedNote', () => {
  it('同じアカウントで削除されたノートの通知だけ落とし、別アカウントの同 id は残す', () => {
    const mine = makeNotif(makeNote({ id: 'gone' }))
    const other = { ...makeNotif(makeNote({ id: 'gone' })), _accountId: 'acc2' }
    const keep = makeNotif(makeNote({ id: 'alive' }))
    const noNote = makeNotif(undefined)
    const result = dropDeletedNote([mine, other, keep, noNote], 'acc1', 'gone')
    expect(result).toEqual([other, keep, noNote])
  })

  it('リノート通知 (renoteId 一致) は落とさない — 表示は述語が隠し、サーバーは返し続ける', () => {
    const renote = makeNotif(
      makeNote({
        id: 'outer',
        text: null,
        renoteId: 'gone',
        renote: undefined,
      }),
    )
    const result = dropDeletedNote([renote], 'acc1', 'gone')
    expect(result).toEqual([renote])
  })
})

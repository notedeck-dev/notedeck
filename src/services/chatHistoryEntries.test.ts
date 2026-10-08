import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/adapters/types'
import {
  buildCrossAccountHistoryEntries,
  buildPerAccountHistoryEntries,
  buildPerAccountPrefetchTargets,
  chatMessageMatchesSearch,
  matchesChatSearch,
} from './chatHistoryEntries'

// ---- fixtures ----

let seq = 0
function dm(
  partial: Partial<ChatMessage> & { fromUserId: string },
): ChatMessage {
  seq++
  return {
    id: `m${seq}`,
    createdAt: `2026-07-0${(seq % 9) + 1}T00:00:00.000Z`,
    ...partial,
  }
}

const ME = 'me'
const OTHER = 'other-1'

describe('buildCrossAccountHistoryEntries', () => {
  const getUserId = (accountId: string) =>
    accountId === 'acc-a' ? ME : undefined

  it('thread (room/DM) 単位で最新 1 件に dedup し、新しい順に並べる', () => {
    const older = dm({
      fromUserId: OTHER,
      toUserId: ME,
      createdAt: '2026-07-01T00:00:00.000Z',
      text: 'old',
    })
    const newer = dm({
      fromUserId: ME,
      toUserId: OTHER,
      createdAt: '2026-07-02T00:00:00.000Z',
      text: 'new',
    })
    const room = dm({
      fromUserId: OTHER,
      toRoomId: 'room-1',
      toRoom: { id: 'room-1', name: '雑談' },
      createdAt: '2026-07-03T00:00:00.000Z',
    })
    const entries = buildCrossAccountHistoryEntries(
      [older, newer, room].map((msg) => ({
        msg,
        accountId: 'acc-a',
        host: 'misskey.example',
      })),
      getUserId,
    )

    expect(entries).toHaveLength(2)
    // 新しい順: room が先頭、DM thread は最新の 1 件のみ
    expect(entries[0]).toMatchObject({
      key: 'acc-a:room:room-1',
      isRoom: true,
      name: '雑談',
      hasName: true,
      roomId: 'room-1',
      serverHost: 'misskey.example',
    })
    expect(entries[1]).toMatchObject({
      key: `acc-a:user:${OTHER}`,
      isRoom: false,
      otherId: OTHER,
    })
    expect(entries[1]?.message.text).toBe('new')
  })

  it('自分発信の DM は toUser 側を相手として表示する', () => {
    const msg = dm({
      fromUserId: ME,
      toUserId: OTHER,
      toUser: { id: OTHER, username: 'alice', name: 'アリス' },
    })
    const [entry] = buildCrossAccountHistoryEntries(
      [{ msg, accountId: 'acc-a', host: 'h' }],
      getUserId,
    )
    expect(entry).toMatchObject({
      name: 'アリス',
      hasName: true,
      otherId: OTHER,
    })
  })

  it('name は other.name → username → otherId の順に fallback し hasName に反映する', () => {
    const noName = dm({
      fromUserId: 'u1',
      toUserId: ME,
      fromUser: { id: 'u1', username: 'bob' },
    })
    const noUser = dm({ fromUserId: 'u2', toUserId: ME })
    const entries = buildCrossAccountHistoryEntries(
      [noName, noUser].map((msg) => ({ msg, accountId: 'acc-a', host: 'h' })),
      getUserId,
    )
    const byOther = new Map(entries.map((e) => [e.otherId, e]))
    expect(byOther.get('u1')).toMatchObject({ name: 'bob', hasName: false })
    expect(byOther.get('u2')).toMatchObject({ name: 'u2', hasName: false })
  })

  it('room 名が無ければ "Room"、emojis/avatar は最新メッセージ送信者から借りる', () => {
    const msg = dm({
      fromUserId: OTHER,
      toRoomId: 'room-x',
      toRoom: { id: 'room-x' },
      fromUser: {
        id: OTHER,
        username: 'bob',
        avatarUrl: 'https://a/av.png',
        emojis: { wave: 'https://a/wave.png' },
      },
    })
    const [entry] = buildCrossAccountHistoryEntries(
      [{ msg, accountId: 'acc-a', host: 'h' }],
      getUserId,
    )
    expect(entry).toMatchObject({
      name: 'Room',
      hasName: false,
      avatarUrl: 'https://a/av.png',
      emojis: { wave: 'https://a/wave.png' },
    })
  })

  it('相手を導出できない DM (toUserId 無しの自分発信) は skip する', () => {
    const msg = dm({ fromUserId: ME })
    expect(
      buildCrossAccountHistoryEntries(
        [{ msg, accountId: 'acc-a', host: 'h' }],
        getUserId,
      ),
    ).toEqual([])
  })
})

describe('buildPerAccountHistoryEntries', () => {
  it('room / DM を thread 単位で dedup し、入力順 (= 新しい順前提) を保つ', () => {
    const m1 = dm({
      fromUserId: OTHER,
      toUserId: ME,
      fromUser: { id: OTHER, username: 'alice' },
    })
    const m2 = dm({ fromUserId: OTHER, toUserId: ME })
    const m3 = dm({
      fromUserId: ME,
      toRoomId: 'r1',
      toRoom: { id: 'r1', name: 'Dev' },
    })
    const entries = buildPerAccountHistoryEntries([m1, m2, m3], ME)
    expect(entries.map((e) => e.key)).toEqual([`user:${OTHER}`, 'room:r1'])
    expect(entries[0]?.message.id).toBe(m1.id)
  })

  it('myUserId undefined でも fromUserId 側を相手として成立する', () => {
    const msg = dm({
      fromUserId: OTHER,
      toUserId: ME,
      fromUser: { id: OTHER, username: 'alice' },
    })
    const [entry] = buildPerAccountHistoryEntries([msg], undefined)
    expect(entry).toMatchObject({ otherId: OTHER, name: 'alice' })
  })
})

describe('buildPerAccountPrefetchTargets', () => {
  it('thread 単位で dedup した PrefetchTarget を返す', () => {
    const msgs = [
      dm({ fromUserId: OTHER, toUserId: ME }),
      dm({ fromUserId: ME, toUserId: OTHER }),
      dm({ fromUserId: ME, toRoomId: 'r1' }),
      dm({ fromUserId: OTHER, toRoomId: 'r1' }),
    ]
    expect(buildPerAccountPrefetchTargets('acc-a', ME, msgs)).toEqual([
      { accountId: 'acc-a', isRoom: false, targetId: OTHER },
      { accountId: 'acc-a', isRoom: true, targetId: 'r1' },
    ])
  })

  it('相手を導出できないメッセージは無視する', () => {
    expect(
      buildPerAccountPrefetchTargets('acc-a', ME, [dm({ fromUserId: ME })]),
    ).toEqual([])
  })
})

describe('matchesChatSearch', () => {
  it('空クエリは常に true', () => {
    expect(matchesChatSearch('', 'name', null)).toBe(true)
    expect(matchesChatSearch('  ', 'name', undefined)).toBe(true)
  })

  it('thread 名 / プレビュー本文を大文字小文字無視で substring match する', () => {
    expect(matchesChatSearch('ali', 'Alice', null)).toBe(true)
    expect(matchesChatSearch('ALI', 'alice', null)).toBe(true)
    expect(matchesChatSearch('hello', 'alice', 'say HELLO world')).toBe(true)
    expect(matchesChatSearch('xyz', 'alice', 'hello')).toBe(false)
  })
})

describe('chatMessageMatchesSearch', () => {
  const msg = dm({
    fromUserId: OTHER,
    text: 'Meeting at Noon',
    fromUser: { id: OTHER, username: 'alice', name: 'アリス' },
    file: {
      id: 'f1',
      name: 'Report.PDF',
      type: 'application/pdf',
      url: '',
    } as ChatMessage['file'],
  })

  it('本文 / 送信者名 / username / ファイル名で match する', () => {
    expect(chatMessageMatchesSearch('noon', msg)).toBe(true)
    expect(chatMessageMatchesSearch('アリス', msg)).toBe(true)
    expect(chatMessageMatchesSearch('ALICE', msg)).toBe(true)
    expect(chatMessageMatchesSearch('report.pdf', msg)).toBe(true)
    expect(chatMessageMatchesSearch('absent', msg)).toBe(false)
  })
})

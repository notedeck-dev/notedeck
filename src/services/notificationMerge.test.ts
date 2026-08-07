import { describe, expect, it } from 'vitest'

import type { NormalizedNotification } from '@/adapters/types'
import { mergeNotifications } from '@/services/notificationMerge'

function makeNotif(
  id: string,
  createdAt: string,
  partial: Partial<NormalizedNotification> = {},
): NormalizedNotification {
  return {
    id,
    _accountId: 'acc1',
    _serverHost: 'example.com',
    createdAt,
    type: 'reaction',
    ...partial,
  } as NormalizedNotification
}

describe('mergeNotifications', () => {
  it('同一 ID は fresh が勝って 1 件になる', () => {
    const cached = [
      makeNotif('a', '2026-01-01T00:00:02.000Z', { type: 'follow' }),
    ]
    const fresh = [makeNotif('a', '2026-01-01T00:00:02.000Z')]

    const merged = mergeNotifications(fresh, cached, 100)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.type).toBe('reaction')
  })

  it('createdAt の降順に並ぶ', () => {
    const merged = mergeNotifications(
      [makeNotif('mid', '2026-01-01T00:00:02.000Z')],
      [
        makeNotif('old', '2026-01-01T00:00:01.000Z'),
        makeNotif('new', '2026-01-01T00:00:03.000Z'),
      ],
      100,
    )

    expect(merged.map((n) => n.id)).toEqual(['new', 'mid', 'old'])
  })

  it('limit を超えた古い分は切り捨てる', () => {
    const merged = mergeNotifications(
      [makeNotif('new', '2026-01-01T00:00:03.000Z')],
      [
        makeNotif('mid', '2026-01-01T00:00:02.000Z'),
        makeNotif('old', '2026-01-01T00:00:01.000Z'),
      ],
      2,
    )

    expect(merged.map((n) => n.id)).toEqual(['new', 'mid'])
  })

  it('復帰時: REST 補完で取り込み済みの通知がライブ到着と交差しても重複しない (#1006)', () => {
    // resumeBackfill が REST で X を取り込んだ後、ストリーム再配信の X が
    // 描画バッファから届くケース。ID 単位で一意に保たれること
    const existing = [
      makeNotif('x', '2026-01-01T00:00:02.000Z'),
      makeNotif('old', '2026-01-01T00:00:01.000Z'),
    ]
    const liveBatch = [
      makeNotif('x', '2026-01-01T00:00:02.000Z'),
      makeNotif('y', '2026-01-01T00:00:03.000Z'),
    ]

    const merged = mergeNotifications(liveBatch, existing, 100)

    expect(merged.map((n) => n.id)).toEqual(['y', 'x', 'old'])
  })

  // 同一性は通知 ID のみで判定する。表示側 (仮想スクローラのキー・フォロー
  // リクエスト状態・既読マーカー) も ID を一意キーにしているため、ここだけ
  // accountId 複合キーにすると描画キーが重複する。サーバー間の ID 衝突は
  // #1010 で表示側ごと揃えて扱う
  it('バッチ内の重複も 1 件になる', () => {
    const merged = mergeNotifications(
      [
        makeNotif('x', '2026-01-01T00:00:01.000Z'),
        makeNotif('x', '2026-01-01T00:00:01.000Z'),
      ],
      [],
      100,
    )

    expect(merged).toHaveLength(1)
  })
})

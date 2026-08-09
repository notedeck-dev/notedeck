import { describe, expect, it } from 'vitest'
import type { NormalizedNotification } from '@/adapters/types'
import {
  isTutorialNotificationId,
  mergeTutorialNotifications,
} from './tutorialNotifications'
import { emptyProgress, unlockAchievement } from './tutorialProgress'

function notif(id: string, createdAt: string): NormalizedNotification {
  return {
    id,
    _accountId: 'acc-1',
    _serverHost: 'example.com',
    createdAt,
    type: 'reaction',
  }
}

describe('mergeTutorialNotifications', () => {
  it('解除した実績を achievementEarned として差し込む', () => {
    const progress = unlockAchievement(
      emptyProgress(),
      'deck',
      Date.parse('2026-08-05T00:00:00Z'),
    )
    const merged = mergeTutorialNotifications([], progress)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.type).toBe('achievementEarned')
    expect(merged[0]?.achievement).toBe('notedeck:deck')
  })

  it('未解除の実績は出さない', () => {
    expect(mergeTutorialNotifications([], emptyProgress())).toEqual([])
  })

  it('解除時刻の順にサーバー通知と混ぜる (新しい順)', () => {
    const progress = unlockAchievement(
      emptyProgress(),
      'deck',
      Date.parse('2026-08-05T12:00:00Z'),
    )
    const merged = mergeTutorialNotifications(
      [notif('a', '2026-08-06T00:00:00Z'), notif('b', '2026-08-05T00:00:00Z')],
      progress,
    )
    expect(merged.map((n) => n.id)).toEqual([
      'a',
      'notedeck-achievement:deck',
      'b',
    ])
  })

  it('サーバー通知が空でも落ちない', () => {
    const progress = unlockAchievement(emptyProgress(), 'extend', 100)
    expect(mergeTutorialNotifications([], progress)).toHaveLength(1)
  })

  it('元の配列を書き換えない', () => {
    const base = [notif('a', '2026-08-06T00:00:00Z')]
    const progress = unlockAchievement(emptyProgress(), 'extend', 100)
    mergeTutorialNotifications(base, progress)
    expect(base).toHaveLength(1)
  })
})

describe('isTutorialNotificationId', () => {
  it('合成通知の id を見分けられる (ページングの cursor に混ぜないため)', () => {
    expect(isTutorialNotificationId('notedeck-achievement:extend')).toBe(true)
    expect(isTutorialNotificationId('9abc123')).toBe(false)
  })
})

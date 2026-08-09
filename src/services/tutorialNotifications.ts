/**
 * NoteDeck 独自実績の解除を通知欄に流す (#1029)。
 *
 * Misskey 本家がサーバー実績を通知ストリームで届けるので、「実績は通知に出る」
 * はユーザーの既存のメンタルモデルどおり。トーストは数秒で消えてしまい
 * 「習熟の記録」に合わないので、遡って見返せる通知欄を使う。
 *
 * 通知エントリはサーバーにも通知キャッシュにも書かず、達成記録 (正本) から
 * 表示時に合成する。正本が別にあるので重複・不整合が構造的に起きない。
 * 未読バッジも増やさない (煽らない)。
 */

import type { NormalizedNotification } from '@/adapters/types'
import { TUTORIAL_CATEGORIES } from '@/data/tutorialSteps'
import { tutorialAchievementName } from '@/services/tutorialAchievements'
import type { TutorialProgress } from '@/services/tutorialProgress'

const ID_PREFIX = 'notedeck-achievement:'

/**
 * 合成した通知か。用途は 2 つ:
 * - ページングの cursor (untilId) にこの id を渡すとサーバーが解釈できない
 * - アカウントに紐づかずアバターが引けないので、描画側でアプリアイコンに
 *   差し替える
 */
export function isTutorialNotificationId(id: string): boolean {
  return id.startsWith(ID_PREFIX)
}

/**
 * 解除済みの実績を achievementEarned 通知として、サーバー通知に時系列で
 * 混ぜた新しい配列を返す。表示専用で、元の配列は書き換えない。
 */
export function mergeTutorialNotifications(
  notifications: readonly NormalizedNotification[],
  progress: TutorialProgress,
): NormalizedNotification[] {
  const synthesized: NormalizedNotification[] = []
  for (const category of TUTORIAL_CATEGORIES) {
    const at = progress.achievements[category.id]
    if (at == null) continue
    synthesized.push({
      id: `${ID_PREFIX}${category.id}`,
      // アプリ操作の習熟はアカウントに紐づかない。cross-account でも 1 件
      _accountId: '',
      _serverHost: '',
      createdAt: new Date(at).toISOString(),
      type: 'achievementEarned',
      achievement: tutorialAchievementName(category.id),
    })
  }
  if (synthesized.length === 0) return [...notifications]

  return [...notifications, ...synthesized].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
}

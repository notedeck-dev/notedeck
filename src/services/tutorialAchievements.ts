/**
 * NoteDeck 独自実績の表示データ (#1029)。
 *
 * 実績はチュートリアルのカテゴリと 1 対 1 で、達成記録 (tutorial.json5) から
 * 導出する。サーバー実績と同じグリッド・同じ通知欄に流すため、Misskey の
 * `Achievement` と同じ形に変換する。
 *
 * サーバーには書かない。NoteDeck の操作習熟は Misskey の実績とは無関係で、
 * アカウントにも紐づかない。
 */

import {
  TUTORIAL_CATEGORIES,
  type TutorialCategoryId,
} from '@/data/tutorialSteps'
import type { TutorialProgress } from '@/services/tutorialProgress'
import type { Achievement, AchievementBadge } from '@/utils/achievements'

/** 通知・実績欄で NoteDeck 実績を識別する接頭辞 */
const PREFIX = 'notedeck:'

export function tutorialAchievementName(id: TutorialCategoryId): string {
  return `${PREFIX}${id}`
}

/** グリッドに並べる種別と順序 (カテゴリの並び = 学習の順序) */
export const TUTORIAL_ACHIEVEMENT_TYPES: readonly string[] =
  TUTORIAL_CATEGORIES.map((c) => tutorialAchievementName(c.id))

export const TUTORIAL_ACHIEVEMENT_TOTAL = TUTORIAL_ACHIEVEMENT_TYPES.length

/**
 * バッジ。段階が進むほど格を上げる (bronze → silver → gold) ことで、
 * グリッドを見ただけでどこまで来たかが分かる。
 */
export const TUTORIAL_ACHIEVEMENT_BADGES: Record<string, AchievementBadge> =
  Object.fromEntries(
    TUTORIAL_CATEGORIES.map((category, index) => [
      tutorialAchievementName(category.id),
      {
        emoji: category.achievementEmoji,
        frame: (['bronze', 'silver', 'gold'] as const)[index] ?? 'gold',
        bg: null,
      },
    ]),
  )

export const TUTORIAL_ACHIEVEMENT_LABELS: Record<string, string> =
  Object.fromEntries(
    TUTORIAL_CATEGORIES.map((c) => [
      tutorialAchievementName(c.id),
      c.achievementName,
    ]),
  )

/** 達成記録から、解除済みの実績だけを取り出す */
export function tutorialAchievements(
  progress: TutorialProgress,
): Achievement[] {
  const out: Achievement[] = []
  for (const category of TUTORIAL_CATEGORIES) {
    const at = progress.achievements[category.id]
    if (at == null) continue
    out.push({ name: tutorialAchievementName(category.id), unlockedAt: at })
  }
  return out
}

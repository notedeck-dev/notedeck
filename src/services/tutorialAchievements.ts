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
  type TutorialCategory,
  type TutorialCategoryId,
} from '@/data/tutorialSteps'
import type { TutorialProgress } from '@/services/tutorialProgress'
import type { Achievement, AchievementBadge } from '@/utils/achievements'

/** 通知・実績欄で NoteDeck 実績を識別する接頭辞 */
const PREFIX = 'notedeck:'

export function tutorialAchievementName(id: TutorialCategoryId): string {
  return `${PREFIX}${id}`
}

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

export interface TutorialAchievementView {
  /** グリッドに並べる種別 (開放待ちも消さずに並べる) */
  types: string[]
  /** 達成率の分母。開放待ちで未達成のものは含めない */
  total: number
  /** 開放待ち = 案内先の面が隠れていて、まだ達成していないもの (#1036) */
  pending: string[]
}

/**
 * 開発者モードの状態を織り込んだ実績の見え方 (#1036)。
 *
 * 案内先の面が隠れているカテゴリは達成できないので、分母に入れると全部やっても
 * 満数にならない。ただしグリッドからは消さない — 存在ごと隠すと、開発者モードを
 * 有効にした瞬間に総数が増えて達成率が下がったように見える。
 *
 * 一度解除した実績は、あとで隠れる側に回っても達成済みのまま扱う。記録は残って
 * いるので、消すと取り上げられたように見える。
 */
export function tutorialAchievementView(
  progress: TutorialProgress,
  isCategoryExposed: (category: TutorialCategory) => boolean,
): TutorialAchievementView {
  const types: string[] = []
  const pending: string[] = []
  let total = 0
  for (const category of TUTORIAL_CATEGORIES) {
    const name = tutorialAchievementName(category.id)
    types.push(name)
    const earned = progress.achievements[category.id] != null
    if (earned || isCategoryExposed(category)) {
      total++
    } else {
      pending.push(name)
    }
  }
  return { types, total, pending }
}

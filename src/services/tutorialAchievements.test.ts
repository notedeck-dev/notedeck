import { describe, expect, it } from 'vitest'
import { tutorialAchievementView } from '@/services/tutorialAchievements'
import type { TutorialProgress } from '@/services/tutorialProgress'

function progressWith(achievements: Record<string, number>): TutorialProgress {
  return { version: 1, items: {}, achievements }
}

/** 開発者向けカテゴリ (mastery / extend) だけが隠れる状態 */
const onlyGeneralExposed = (c: { exposure?: string }) =>
  c.exposure !== 'developer'
const allExposed = () => true

describe('tutorialAchievementView', () => {
  it('開放待ちの実績は分母から外れる', () => {
    const view = tutorialAchievementView(progressWith({}), onlyGeneralExposed)
    const all = tutorialAchievementView(progressWith({}), allExposed)
    expect(view.total).toBeLessThan(all.total)
    expect(view.total + view.pending.length).toBe(all.total)
  })

  it('開放待ちでもグリッドからは消さない', () => {
    const view = tutorialAchievementView(progressWith({}), onlyGeneralExposed)
    const all = tutorialAchievementView(progressWith({}), allExposed)
    expect(view.types).toEqual(all.types)
    expect(view.pending.length).toBeGreaterThan(0)
  })

  it('解除済みの実績は開放待ちにならず、分母にも残る', () => {
    const earned = tutorialAchievementView(
      progressWith({ extend: 1_700_000_000_000 }),
      onlyGeneralExposed,
    )
    const notEarned = tutorialAchievementView(
      progressWith({}),
      onlyGeneralExposed,
    )
    expect(earned.pending).not.toContain('notedeck:extend')
    expect(earned.total).toBe(notEarned.total + 1)
  })

  it('開発者モードが有効なら開放待ちは無い', () => {
    const view = tutorialAchievementView(progressWith({}), allExposed)
    expect(view.pending).toEqual([])
  })
})

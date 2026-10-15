import { afterEach, describe, expect, it } from 'vitest'
import { loadLocale } from '@/i18n'
import { ACHIEVEMENT_TYPES } from '@/services/achievements'
import { ACHIEVEMENT_LABELS } from './achievementLabels'

describe('ACHIEVEMENT_LABELS', () => {
  afterEach(async () => {
    await loadLocale('ja-JP')
  })

  it('既知の実績名すべてに空でない表示名がある', () => {
    for (const name of ACHIEVEMENT_TYPES) {
      const label = ACHIEVEMENT_LABELS[name]
      expect(typeof label, name).toBe('string')
      expect(label?.trim(), name).not.toBe('')
    }
  })

  it('表示名の表は既知の実績名と過不足なく対応する', () => {
    expect(Object.keys(ACHIEVEMENT_LABELS).sort()).toEqual(
      [...ACHIEVEMENT_TYPES].sort(),
    )
  })

  it('表示名どうしが重複しない', () => {
    const labels = ACHIEVEMENT_TYPES.map((n) => ACHIEVEMENT_LABELS[n])
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('未知の実績名には表示名が無い (呼び出し側が名前へ倒す)', () => {
    expect(ACHIEVEMENT_LABELS.unknownAchievement).toBeUndefined()
  })

  it('表示言語を切り替えると参照した時点の言語の文言を返す', async () => {
    const ja = ACHIEVEMENT_LABELS.notes1
    await loadLocale('en-US')
    const en = ACHIEVEMENT_LABELS.notes1
    expect(en).not.toBe(ja)
    expect(en?.trim()).not.toBe('')
  })
})

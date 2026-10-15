import { describe, expect, it } from 'vitest'
import { ACHIEVEMENT_TOTAL, ACHIEVEMENT_TYPES } from './achievements'

describe('ACHIEVEMENT_TYPES', () => {
  it('同じ実績名が二度出てこない', () => {
    expect(new Set(ACHIEVEMENT_TYPES).size).toBe(ACHIEVEMENT_TYPES.length)
  })

  it('ACHIEVEMENT_TOTAL は実績名の数と一致する', () => {
    expect(ACHIEVEMENT_TOTAL).toBe(ACHIEVEMENT_TYPES.length)
  })

  it('実績名はすべて英数字だけの識別子になっている', () => {
    for (const name of ACHIEVEMENT_TYPES) {
      expect(name).toMatch(/^[A-Za-z0-9]+$/)
    }
  })

  it('段階のある実績は閾値の小さい順に並ぶ', () => {
    // グリッドは未解除分をこの順で並べるので、段階が前後すると見た目が崩れる
    for (const prefix of ['notes', 'login', 'following', 'followers']) {
      const thresholds = ACHIEVEMENT_TYPES.filter((n) =>
        new RegExp(`^${prefix}\\d+$`).test(n),
      ).map((n) => Number(n.slice(prefix.length)))
      expect(thresholds.length).toBeGreaterThan(1)
      expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b))
    }
  })
})

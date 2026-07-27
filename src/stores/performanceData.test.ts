import { describe, expect, it } from 'vitest'
import {
  categoryKeys,
  detectPosition,
  FADER_CATEGORIES,
  interpolateCategory,
  interpolateConfig,
  interpolateKey,
  SLIDER_HIGH,
  SLIDER_LOW,
} from '@/stores/performanceData'

describe('interpolateKey', () => {
  it('両端は SLIDER_LOW / SLIDER_HIGH そのもの', () => {
    expect(interpolateKey('noteStoreMax', 0)).toBe(SLIDER_LOW.noteStoreMax)
    expect(interpolateKey('noteStoreMax', 1)).toBe(SLIDER_HIGH.noteStoreMax)
    expect(interpolateKey('streamPollingInterval', 0)).toBe(
      SLIDER_LOW.streamPollingInterval,
    )
    expect(interpolateKey('streamPollingInterval', 1)).toBe(
      SLIDER_HIGH.streamPollingInterval,
    )
  })

  it('中点は対数補間なので線形の中点より低い (増加キー)', () => {
    // 800 → 3000: 線形なら 1900、対数なら √(800×3000) ≒ 1549
    const mid = interpolateKey('noteStoreMax', 0.5)
    expect(mid).toBeLessThan(1900)
    expect(mid).toBeGreaterThan(SLIDER_LOW.noteStoreMax)
  })

  it('値が下がるキーも対数で単調に減る', () => {
    // 30s → 5s
    const values = [0, 0.25, 0.5, 0.75, 1].map((t) =>
      interpolateKey('streamPollingInterval', t),
    )
    for (let i = 1; i < values.length; i++) {
      expect(Number(values[i])).toBeLessThanOrEqual(Number(values[i - 1]))
    }
    expect(interpolateKey('streamPollingInterval', 0.5)).toBeLessThan(17.5) // 線形中点
  })

  it('端点に 0 を含むキーは線形にフォールバックする', () => {
    // cssBlurLevel: 0 → 2 は対数補間が定義できない
    expect(interpolateKey('cssBlurLevel', 0)).toBe(0)
    expect(interpolateKey('cssBlurLevel', 0.5)).toBe(1)
    expect(interpolateKey('cssBlurLevel', 1)).toBe(2)
  })
})

describe('interpolateCategory', () => {
  it('そのカテゴリの key だけを返す', () => {
    const patch = interpolateCategory('polling', 1)
    expect(Object.keys(patch).sort()).toEqual(
      categoryKeys('polling').slice().sort(),
    )
    expect(patch.streamPollingInterval).toBe(SLIDER_HIGH.streamPollingInterval)
  })

  it('可変キーを持たないカテゴリはフェーダー対象から外れる', () => {
    // interaction は LOW と HIGH が全て同値
    expect(FADER_CATEGORIES).not.toContain('interaction')
    expect(FADER_CATEGORIES).toContain('polling')
  })
})

describe('detectPosition', () => {
  it('フェーダーで作った値なら exact に一致する', () => {
    const cfg = { ...interpolateConfig(0.4) }
    const found = detectPosition(cfg, categoryKeys('polling'))
    expect(found.exact).toBe(true)
    // step 丸めで同じ値になる t が複数あるので、位置そのものではなく
    // 「その位置から作り直すと同じ値になる」ことを見る
    expect(interpolateCategory('polling', found.t)).toEqual({
      streamPollingInterval: cfg.streamPollingInterval,
      notificationPollInterval: cfg.notificationPollInterval,
      chatPollInterval: cfg.chatPollInterval,
    })
  })

  it('手で外した値は exact=false でも最も近い位置を返す', () => {
    const cfg = { ...interpolateConfig(0.4), streamPollingInterval: 7 }
    const found = detectPosition(cfg, categoryKeys('polling'))
    expect(found.exact).toBe(false)
    expect(found.t).toBeGreaterThan(0)
    expect(found.t).toBeLessThanOrEqual(1)
  })
})

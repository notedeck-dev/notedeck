import { describe, expect, it } from 'vitest'
import {
  clearProgress,
  emptyProgress,
  markItemDone,
  mergeProgress,
  parseTutorialProgress,
  serializeTutorialProgress,
  unlockAchievement,
} from './tutorialProgress'

describe('parseTutorialProgress', () => {
  it('serialize したものを読み戻せる', () => {
    const p = markItemDone(emptyProgress(), 'account-login', 100)
    expect(parseTutorialProgress(serializeTutorialProgress(p))).toEqual(p)
  })

  it('空文字・壊れた JSON5・型違いは空の進捗に倒す', () => {
    expect(parseTutorialProgress('')).toEqual(emptyProgress())
    expect(parseTutorialProgress('{ items: ')).toEqual(emptyProgress())
    expect(parseTutorialProgress('[]')).toEqual(emptyProgress())
    expect(parseTutorialProgress('{ items: 3 }')).toEqual(emptyProgress())
  })

  it('数値でない達成時刻は捨てる', () => {
    const p = parseTutorialProgress(
      '{ version: 1, items: { a: 100, b: "x", c: null } }',
    )
    expect(p.items).toEqual({ a: 100 })
  })
})

describe('markItemDone', () => {
  it('達成時刻を記録する', () => {
    const p = markItemDone(emptyProgress(), 'account-login', 100)
    expect(p.items['account-login']).toBe(100)
  })

  it('記録済みの項目は上書きしない (最初の達成時刻を残す)', () => {
    let p = markItemDone(emptyProgress(), 'account-login', 100)
    p = markItemDone(p, 'account-login', 200)
    expect(p.items['account-login']).toBe(100)
  })

  it('元の進捗を書き換えない', () => {
    const before = emptyProgress()
    markItemDone(before, 'account-login', 100)
    expect(before.items).toEqual({})
  })
})

describe('unlockAchievement', () => {
  it('カテゴリ実績の解除時刻を記録する', () => {
    const p = unlockAchievement(emptyProgress(), 'first-steps', 100)
    expect(p.achievements['first-steps']).toBe(100)
  })

  it('解除済みなら時刻を上書きしない', () => {
    let p = unlockAchievement(emptyProgress(), 'first-steps', 100)
    p = unlockAchievement(p, 'first-steps', 200)
    expect(p.achievements['first-steps']).toBe(100)
  })
})

describe('mergeProgress', () => {
  it('両者の項目を統合する', () => {
    const a = markItemDone(emptyProgress(), 'a', 100)
    const b = markItemDone(emptyProgress(), 'b', 200)
    expect(mergeProgress(a, b).items).toEqual({ a: 100, b: 200 })
  })

  it('衝突した達成時刻は早い方を残す (別ウィンドウの書き込みで巻き戻さない)', () => {
    const a = markItemDone(emptyProgress(), 'a', 200)
    const b = markItemDone(emptyProgress(), 'a', 100)
    expect(mergeProgress(a, b).items['a']).toBe(100)
  })

  it('実績も同様に統合する', () => {
    const a = unlockAchievement(emptyProgress(), 'ide', 200)
    const b = unlockAchievement(emptyProgress(), 'ai', 100)
    const merged = mergeProgress(a, b)
    expect(merged.achievements).toEqual({ ide: 200, ai: 100 })
  })
})

describe('clearProgress', () => {
  it('記録を消し、消した時刻を残す', () => {
    const cleared = clearProgress(500)
    expect(cleared.items).toEqual({})
    expect(cleared.achievements).toEqual({})
    expect(cleared.resetAt).toBe(500)
  })

  it('消した時刻より前の記録はマージで復活しない', () => {
    const old = markItemDone(emptyProgress(), 'a', 100)
    const merged = mergeProgress(old, clearProgress(500))
    expect(merged.items).toEqual({})
  })

  it('消した後の達成はマージで残る', () => {
    const fresh = markItemDone(clearProgress(500), 'a', 600)
    expect(
      mergeProgress(markItemDone(emptyProgress(), 'a', 100), fresh).items,
    ).toEqual({ a: 600 })
  })

  it('消した時刻は serialize / parse を往復する', () => {
    const cleared = clearProgress(500)
    expect(
      parseTutorialProgress(serializeTutorialProgress(cleared)).resetAt,
    ).toBe(500)
  })
})

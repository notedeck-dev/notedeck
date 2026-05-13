import { describe, expect, it } from 'vitest'
import {
  PERFORMANCE_BUILTIN_CAPABILITIES,
  performanceApplySliderCapability,
  performanceListCapability,
  performanceResetAllCapability,
  performanceResetCapability,
  performanceSetCapability,
} from './performance'

// Note: execute は usePerformanceStore (Pinia) を呼ぶため unit 環境では走らない。
// capability 定義と引数バリデーションのみ検証する。

describe('performance capabilities — declaration', () => {
  it('performance.list: no permission, cheap', () => {
    expect(performanceListCapability.id).toBe('performance.list')
    expect(performanceListCapability.permissions).toEqual([])
    expect(performanceListCapability.signature?.cheap).toBe(true)
    expect(performanceListCapability.signature?.returns?.type).toBe('array')
  })

  it('performance.set: write permission, confirmation, validates key/value', () => {
    expect(performanceSetCapability.id).toBe('performance.set')
    expect(performanceSetCapability.permissions).toEqual(['performance.write'])
    expect(typeof performanceSetCapability.requiresConfirmation).toBe(
      'function',
    )
    expect(() => performanceSetCapability.execute({ value: 100 })).toThrow(
      /key is required/,
    )
    expect(() =>
      performanceSetCapability.execute({ key: 'unknownKey', value: 100 }),
    ).toThrow(/unknown key/)
    expect(() =>
      performanceSetCapability.execute({ key: 'emojiCachePerHost' }),
    ).toThrow(/value must be a finite number/)
    expect(() =>
      performanceSetCapability.execute({
        key: 'emojiCachePerHost',
        value: Number.NaN,
      }),
    ).toThrow(/value must be a finite number/)
  })

  it('performance.reset: write permission, requires key', () => {
    expect(performanceResetCapability.id).toBe('performance.reset')
    expect(performanceResetCapability.permissions).toEqual([
      'performance.write',
    ])
    expect(() => performanceResetCapability.execute({})).toThrow(
      /key is required/,
    )
    expect(() =>
      performanceResetCapability.execute({ key: 'unknownKey' }),
    ).toThrow(/unknown key/)
  })

  it('performance.resetAll: write permission, no params', () => {
    expect(performanceResetAllCapability.id).toBe('performance.resetAll')
    expect(performanceResetAllCapability.permissions).toEqual([
      'performance.write',
    ])
    expect(typeof performanceResetAllCapability.requiresConfirmation).toBe(
      'function',
    )
  })

  it('performance.applySlider: write permission, validates t', () => {
    expect(performanceApplySliderCapability.id).toBe('performance.applySlider')
    expect(performanceApplySliderCapability.permissions).toEqual([
      'performance.write',
    ])
    expect(() => performanceApplySliderCapability.execute({})).toThrow(
      /t must be a finite number/,
    )
    expect(() =>
      performanceApplySliderCapability.execute({ t: Number.NaN }),
    ).toThrow(/t must be a finite number/)
  })
})

describe('PERFORMANCE_BUILTIN_CAPABILITIES', () => {
  it('contains all 5 capabilities', () => {
    const ids = PERFORMANCE_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'performance.applySlider',
      'performance.list',
      'performance.reset',
      'performance.resetAll',
      'performance.set',
    ])
  })

  it('all capabilities are exposed to AI (aiTool: true)', () => {
    for (const cap of PERFORMANCE_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} should be aiTool`).toBe(true)
    }
  })
})

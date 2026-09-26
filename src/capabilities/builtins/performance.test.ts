import { describe, expect, it } from 'vitest'
import {
  PERFORMANCE_BUILTIN_CAPABILITIES,
  performanceListCapability,
  performanceResetAllCapability,
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

  it('performance.resetAll: write permission, no params', () => {
    expect(performanceResetAllCapability.id).toBe('performance.resetAll')
    expect(performanceResetAllCapability.permissions).toEqual([
      'performance.write',
    ])
    expect(typeof performanceResetAllCapability.requiresConfirmation).toBe(
      'function',
    )
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

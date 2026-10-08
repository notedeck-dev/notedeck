import { beforeEach, describe, expect, it } from 'vitest'
import { readSafeMode } from './safeMode'

// 判定規則は src/services/safeModeSources.test.ts。ここは localStorage の読み取りだけ

describe('readSafeMode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('localStorage の値をそのまま反映する', () => {
    expect(readSafeMode()).toBe(false)
    localStorage.setItem('nd-safe-mode', 'true')
    expect(readSafeMode()).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { generateSessionTitle, timestampTitle } from '@/utils/aiSessionTitle'

// 整形規則は src/services/sessionTitle.test.ts。ここは i18n の既定接尾辞だけ

const FROZEN = new Date(2026, 3, 30, 15, 30, 12) // 2026-04-30 local

describe('aiSessionTitle (i18n の既定接尾辞)', () => {
  it('timestampTitle は接尾辞を省くと「のチャット」', () => {
    expect(timestampTitle(FROZEN)).toBe('2026-04-30 15:30 のチャット')
  })

  it('timestampTitle は接尾辞を渡せば差し替わる', () => {
    expect(timestampTitle(FROZEN, 'のHEARTBEAT')).toBe(
      '2026-04-30 15:30 のHEARTBEAT',
    )
  })

  it('generateSessionTitle のフォールバックも「のチャット」', () => {
    expect(generateSessionTitle('hi', FROZEN)).toBe(
      '2026-04-30 15:30 のチャット',
    )
  })
})

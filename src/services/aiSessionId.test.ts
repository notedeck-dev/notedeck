import { describe, expect, it } from 'vitest'
import {
  formatLocalTimestamp,
  generateSessionId,
  resolveCollisionSuffix,
  timestampToSessionIdBase,
} from '@/services/aiSessionId'

describe('formatLocalTimestamp', () => {
  it('returns 14-digit YYYYMMDDhhmmss in local timezone', () => {
    const d = new Date(2026, 3, 30, 15, 30, 12) // 2026-04-30 15:30:12 local
    expect(formatLocalTimestamp(d)).toBe('20260430153012')
  })

  it('zero-pads single-digit components', () => {
    const d = new Date(2026, 0, 5, 3, 7, 9)
    expect(formatLocalTimestamp(d)).toBe('20260105030709')
  })
})

describe('resolveCollisionSuffix', () => {
  it('returns base when no collision', () => {
    expect(resolveCollisionSuffix('20260430153012', new Set())).toBe(
      '20260430153012',
    )
  })

  it('appends "a" on first collision', () => {
    expect(
      resolveCollisionSuffix('20260430153012', new Set(['20260430153012'])),
    ).toBe('20260430153012a')
  })

  it('appends "b" when "a" also taken', () => {
    expect(
      resolveCollisionSuffix(
        '20260430153012',
        new Set(['20260430153012', '20260430153012a']),
      ),
    ).toBe('20260430153012b')
  })

  it('falls back to two-letter suffix after exhausting a-z', () => {
    const taken = new Set(['20260430153012'])
    for (let i = 0; i < 26; i++) {
      taken.add(`20260430153012${String.fromCharCode(0x61 + i)}`)
    }
    expect(resolveCollisionSuffix('20260430153012', taken)).toBe(
      '20260430153012aa',
    )
  })
})

describe('generateSessionId', () => {
  it('uses timestamp from given Date', () => {
    const d = new Date(2026, 3, 30, 15, 30, 12)
    expect(generateSessionId(d, new Set())).toBe('20260430153012')
  })

  it('avoids collision with existing IDs', () => {
    const d = new Date(2026, 3, 30, 15, 30, 12)
    expect(generateSessionId(d, new Set(['20260430153012']))).toBe(
      '20260430153012a',
    )
  })
})

describe('timestampToSessionIdBase', () => {
  it('formats epoch ms back to session id base', () => {
    const epoch = new Date(2026, 3, 30, 15, 30, 12).getTime()
    expect(timestampToSessionIdBase(epoch)).toBe('20260430153012')
  })
})

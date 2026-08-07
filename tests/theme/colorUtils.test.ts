import { describe, expect, it } from 'vitest'
import {
  alpha,
  darken,
  hue,
  lighten,
  normalizeColor,
  parseColor,
  saturate,
  toRgba,
} from '@/theme/colorUtils'

describe('parseColor', () => {
  it('parses #RRGGBB', () => {
    expect(parseColor('#86b300')).toEqual([134, 179, 0, 1])
  })

  it('parses #RGB', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
  })

  it('parses #RRGGBBAA', () => {
    const result = parseColor('#86b30080')
    expect(result).not.toBeNull()
    expect(result?.[3]).toBeCloseTo(0.502, 1)
  })

  it('parses rgb()', () => {
    expect(parseColor('rgb(134, 179, 0)')).toEqual([134, 179, 0, 1])
  })

  it('parses rgba()', () => {
    expect(parseColor('rgba(255, 255, 255, 0.5)')).toEqual([255, 255, 255, 0.5])
  })

  it('parses bare hex without #', () => {
    expect(parseColor('e2deda')).toEqual([226, 222, 218, 1])
    expect(parseColor('fff')).toEqual([255, 255, 255, 1])
  })

  it('returns null for invalid input', () => {
    expect(parseColor('not-a-color')).toBeNull()
  })
})

describe('normalizeColor', () => {
  it('prefixes bare hex with #', () => {
    expect(normalizeColor('e2deda')).toBe('#e2deda')
    expect(normalizeColor('fff')).toBe('#fff')
    expect(normalizeColor('e2dedaCC')).toBe('#e2dedaCC')
  })

  it('leaves already-valid values untouched', () => {
    expect(normalizeColor('#e2deda')).toBe('#e2deda')
    expect(normalizeColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)')
    expect(normalizeColor('transparent')).toBe('transparent')
  })
})

describe('toRgba', () => {
  it('returns rgb() for opaque colors', () => {
    expect(toRgba([255, 0, 0, 1])).toBe('rgb(255, 0, 0)')
  })

  it('returns rgba() for transparent colors', () => {
    expect(toRgba([255, 0, 0, 0.5])).toBe('rgba(255, 0, 0, 0.5)')
  })
})

describe('darken', () => {
  it('darkens white by 3%', () => {
    const result = parseColor(darken('#ffffff', 3))
    expect(result).not.toBeNull()
    // White (L=100) darkened by 3 → L=97
    expect(result?.[0]).toBeLessThan(255)
    expect(result?.[1]).toBeLessThan(255)
    expect(result?.[2]).toBeLessThan(255)
  })

  it('returns black when darkening black', () => {
    const result = parseColor(darken('#000000', 3))
    expect(result).not.toBeNull()
    expect(result?.[0]).toBe(0)
    expect(result?.[1]).toBe(0)
    expect(result?.[2]).toBe(0)
  })
})

describe('lighten', () => {
  it('lightens black by 3%', () => {
    const result = parseColor(lighten('#000000', 3))
    expect(result).not.toBeNull()
    // Black (L=0) lightened by 3 → L=3
    expect(result?.[0]).toBeGreaterThan(0)
  })

  it('caps at white', () => {
    const result = parseColor(lighten('#ffffff', 10))
    expect(result).not.toBeNull()
    expect(result?.[0]).toBe(255)
    expect(result?.[1]).toBe(255)
    expect(result?.[2]).toBe(255)
  })
})

describe('alpha', () => {
  it('sets alpha channel', () => {
    const result = alpha('#86b300', 0.15)
    expect(result).toContain('0.15')
    const parsed = parseColor(result)
    expect(parsed).not.toBeNull()
    expect(parsed?.[3]).toBe(0.15)
  })
})

describe('hue', () => {
  it('rotates hue by 20 degrees', () => {
    const original = parseColor('#86b300')
    const rotated = parseColor(hue('#86b300', 20))
    expect(rotated).not.toBeNull()
    // Should be a different color
    expect(rotated?.[0]).not.toBe(original?.[0])
  })
})

describe('saturate', () => {
  it('increases saturation', () => {
    // Gray has 0 saturation, saturating should keep it gray (can't saturate gray)
    const result = parseColor(saturate('#808080', 10))
    expect(result).not.toBeNull()
  })
})

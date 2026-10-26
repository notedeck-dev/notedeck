import { describe, expect, it, vi } from 'vitest'
import { detectQualitySync } from './adaptiveQuality'

describe('detectQualitySync', () => {
  it('prefers-reduced-motion で low を返す', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    })

    expect(detectQualitySync()).toBe('low')
    vi.unstubAllGlobals()
  })

  it('2コア以下で low を返す', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })

    expect(detectQualitySync()).toBe('low')
    vi.unstubAllGlobals()
  })

  it('8コア以上で high を返す', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })

    expect(detectQualitySync()).toBe('high')
    vi.unstubAllGlobals()
  })

  it('4コアで balanced を返す', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })

    expect(detectQualitySync()).toBe('balanced')
    vi.unstubAllGlobals()
  })

  it('deviceMemory 2GB 以下で low を返す', () => {
    vi.stubGlobal('navigator', {
      hardwareConcurrency: 4,
      deviceMemory: 2,
    })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })

    expect(detectQualitySync()).toBe('low')
    vi.unstubAllGlobals()
  })

  it('deviceMemory 8GB 以上で high を返す', () => {
    vi.stubGlobal('navigator', {
      hardwareConcurrency: 4,
      deviceMemory: 8,
    })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    })

    expect(detectQualitySync()).toBe('high')
    vi.unstubAllGlobals()
  })
})

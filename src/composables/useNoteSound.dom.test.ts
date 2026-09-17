import { describe, expect, it, vi } from 'vitest'

const systemState = vi.hoisted(() => ({ muteSounds: false }))
vi.mock('@/stores/systemState', () => ({
  useSystemStateStore: () => ({
    adaptation: { muteSounds: systemState.muteSounds },
  }),
}))
vi.mock('@/stores/performance', () => ({
  usePerformanceStore: () => ({ get: () => 8 }),
}))

/** 音源に触れたら失敗させる。ゲートが効いていれば呼ばれない */
class ExplodingAudioContext {
  constructor() {
    throw new Error('AudioContext must not be created while muted')
  }
}

describe('useNoteSound.play', () => {
  it('OS の集中モード中 (muteSounds) は音源に触れずに何もしない (#928)', async () => {
    systemState.muteSounds = true
    vi.stubGlobal('AudioContext', ExplodingAudioContext)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.resetModules()
    const { useNoteSound } = await import('@/composables/useNoteSound')
    const { play } = useNoteSound(() => 'misskey.example')
    await expect(play()).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

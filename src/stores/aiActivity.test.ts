import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { _resetAiActivityForTest, useAiActivity } from './aiActivity'

describe('useAiActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetAiActivityForTest()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('begin で恒常状態が立ち、返された end で戻る', async () => {
    const { petState, begin } = useAiActivity()
    expect(petState.value).toBe('idle')
    const end = begin('running')
    await nextTick()
    expect(petState.value).toBe('running')
    end()
    await nextTick()
    expect(petState.value).toBe('idle')
  })

  it('end を二度呼んでも数が負にならない', async () => {
    const { petState, begin } = useAiActivity()
    const end = begin('review')
    end()
    end()
    const end2 = begin('review')
    await nextTick()
    expect(petState.value).toBe('review')
    end2()
    await nextTick()
    expect(petState.value).toBe('idle')
  })

  it('複数の発生源が同時に動いても 1 つに畳まれる', async () => {
    const { petState, begin } = useAiActivity()
    const endA = begin('running')
    const endB = begin('review')
    await nextTick()
    expect(petState.value).toBe('running')
    endA()
    await nextTick()
    expect(petState.value).toBe('review')
    endB()
  })

  it('pulse は表示時間が過ぎると自動で消える', async () => {
    const { petState, pulse } = useAiActivity()
    pulse('waving')
    await nextTick()
    expect(petState.value).toBe('waving')
    vi.advanceTimersByTime(699)
    await nextTick()
    expect(petState.value).toBe('waving')
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(petState.value).toBe('idle')
  })

  it('新しい pulse は前の pulse を置き換える', async () => {
    const { petState, pulse } = useAiActivity()
    pulse('waving')
    vi.advanceTimersByTime(300)
    pulse('failed')
    await nextTick()
    expect(petState.value).toBe('failed')
    vi.advanceTimersByTime(1219)
    await nextTick()
    expect(petState.value).toBe('failed')
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(petState.value).toBe('idle')
  })

  it('承認待ちは pulse より優先される', async () => {
    const { petState, begin, pulse } = useAiActivity()
    const end = begin('waiting')
    pulse('jumping')
    await nextTick()
    expect(petState.value).toBe('waiting')
    end()
    await nextTick()
    expect(petState.value).toBe('jumping')
  })
})

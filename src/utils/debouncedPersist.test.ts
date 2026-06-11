import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedPersist } from './debouncedPersist'

describe('createDebouncedPersist', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedule は delayMs 後に 1 回だけ persist を呼ぶ (debounce)', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const { schedule } = createDebouncedPersist(persist, { delayMs: 100 })

    schedule()
    schedule()
    schedule()
    expect(persist).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('persist の失敗は onError に渡される (schedule 経路)', async () => {
    const cause = new Error('disk full')
    const persist = vi.fn().mockRejectedValue(cause)
    const onError = vi.fn()
    const { schedule } = createDebouncedPersist(persist, {
      delayMs: 100,
      onError,
    })

    schedule()
    await vi.advanceTimersByTimeAsync(100)
    expect(onError).toHaveBeenCalledWith(cause)
  })

  it('flush はペンディングがあれば即時 persist し、なければ no-op', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const { schedule, flush } = createDebouncedPersist(persist, {
      delayMs: 100,
    })

    await flush()
    expect(persist).not.toHaveBeenCalled()

    schedule()
    await flush()
    expect(persist).toHaveBeenCalledTimes(1)

    // flush 済みなのでタイマーは発火しない
    await vi.advanceTimersByTimeAsync(200)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('flush は persist の失敗を呼び出し元へ伝播する', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('boom'))
    const { schedule, flush } = createDebouncedPersist(persist, {
      delayMs: 100,
    })

    schedule()
    await expect(flush()).rejects.toThrow('boom')
  })

  it('cancel はペンディングを破棄する', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const { schedule, cancel } = createDebouncedPersist(persist, {
      delayMs: 100,
    })

    schedule()
    cancel()
    await vi.advanceTimersByTimeAsync(200)
    expect(persist).not.toHaveBeenCalled()
  })
})

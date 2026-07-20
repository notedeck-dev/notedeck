import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dedup } from '@/utils/dedup'

// dedup はモジュールレベルのキャッシュを持つため、テストごとに一意なキーを使う
let seq = 0
const uniqueKey = () => `test-key-${seq++}`

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('dedup', () => {
  it('shares one in-flight promise for concurrent calls with the same key', async () => {
    const key = uniqueKey()
    let resolve!: (v: string) => void
    const fn = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r
        }),
    )

    const p1 = dedup(key, fn)
    const p2 = dedup(key, fn)
    expect(fn).toHaveBeenCalledTimes(1)

    resolve('result')
    expect(await p1).toBe('result')
    expect(await p2).toBe('result')
  })

  it('serves from response cache within TTL', async () => {
    const key = uniqueKey()
    const fn = vi.fn().mockResolvedValue('cached')

    expect(await dedup(key, fn)).toBe('cached')
    vi.advanceTimersByTime(4999)
    expect(await dedup(key, fn)).toBe('cached')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after the TTL expires', async () => {
    const key = uniqueKey()
    const fn = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')

    expect(await dedup(key, fn)).toBe('first')
    vi.advanceTimersByTime(5001)
    expect(await dedup(key, fn)).toBe('second')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('keeps different keys independent', async () => {
    const fnA = vi.fn().mockResolvedValue('a')
    const fnB = vi.fn().mockResolvedValue('b')

    expect(await dedup(uniqueKey(), fnA)).toBe('a')
    expect(await dedup(uniqueKey(), fnB)).toBe('b')
    expect(fnA).toHaveBeenCalledTimes(1)
    expect(fnB).toHaveBeenCalledTimes(1)
  })

  it('does not cache rejections — next call retries', async () => {
    const key = uniqueKey()
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered')

    await expect(dedup(key, fn)).rejects.toThrow('boom')
    expect(await dedup(key, fn)).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

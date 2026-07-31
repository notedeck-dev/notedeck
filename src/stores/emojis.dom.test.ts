import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerEmoji } from '@/adapters/types'
import { useEmojisStore } from '@/stores/emojis'

vi.mock('@/stores/performance', () => ({
  usePerformanceStore: () => ({ get: () => 10 }),
}))

const HOST = 'misskey.example'

function emoji(name: string): ServerEmoji {
  return {
    name,
    url: `https://${HOST}/files/${name}.webp`,
    category: null,
    aliases: [],
  }
}

/** ensureLoaded の fetcher promise を解決させる */
async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('useEmojisStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ensureLoaded で取得した絵文字を resolve できる', async () => {
    const store = useEmojisStore()
    const fetcher = vi.fn().mockResolvedValue([emoji('meow')])
    store.ensureLoaded(HOST, fetcher)
    await flush()
    expect(store.resolve(HOST, 'meow')).toBe(`https://${HOST}/files/meow.webp`)
    // ローカルマーカー付きキーでも引ける
    expect(store.resolve(HOST, 'meow@.')).toBe(
      `https://${HOST}/files/meow.webp`,
    )
  })

  it('未解決の reportMiss がデバウンス後に再取得し、新しい絵文字が解決できるようになる', async () => {
    const store = useEmojisStore()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce([emoji('old')])
      .mockResolvedValue([emoji('old'), emoji('brand_new')])
    store.ensureLoaded(HOST, fetcher)
    await flush()
    expect(store.resolve(HOST, 'brand_new')).toBeNull()

    store.reportMiss(HOST, 'brand_new')
    await vi.advanceTimersByTimeAsync(3_000)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(store.resolve(HOST, 'brand_new')).toBe(
      `https://${HOST}/files/brand_new.webp`,
    )
  })

  it('再取得しても存在しない名前は以後 refetch をトリガーしない', async () => {
    const store = useEmojisStore()
    const fetcher = vi.fn().mockResolvedValue([emoji('meow')])
    store.ensureLoaded(HOST, fetcher)
    await flush()

    store.reportMiss(HOST, 'ghost')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetcher).toHaveBeenCalledTimes(2)

    // 同じ名前の miss はもう再取得を起こさない (空振りループ防止)
    store.reportMiss(HOST, 'ghost')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('リモート形式 (name@host) の miss は refetch をトリガーしない', async () => {
    const store = useEmojisStore()
    const fetcher = vi.fn().mockResolvedValue([emoji('meow')])
    store.ensureLoaded(HOST, fetcher)
    await flush()

    store.reportMiss(HOST, 'meow@remote.example')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('ensureLoaded していない host の miss は何もしない', async () => {
    const store = useEmojisStore()
    store.reportMiss('unknown.example', 'meow')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    // fetcher が無いので何も起きない (例外にならないことの確認)
    expect(store.resolve('unknown.example', 'meow')).toBeNull()
  })

  it('クールダウン内の新たな miss は次の再取得までまとめて遅延される', async () => {
    const store = useEmojisStore()
    const fetcher = vi.fn().mockResolvedValue([emoji('meow')])
    store.ensureLoaded(HOST, fetcher)
    await flush()

    store.reportMiss(HOST, 'first')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetcher).toHaveBeenCalledTimes(2)

    // 直後の別の miss はデバウンスではなくクールダウン明けまで待つ
    store.reportMiss(HOST, 'second')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('取得済みでも 24 時間経過後の ensureLoaded は背景で再取得する', async () => {
    const store = useEmojisStore()
    const fetcher = vi.fn().mockResolvedValue([emoji('meow')])
    store.ensureLoaded(HOST, fetcher)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)

    // 24 時間以内は何もしない
    store.ensureLoaded(HOST, fetcher)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetcher).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(25 * 60 * 60_000)
    store.ensureLoaded(HOST, fetcher)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fetcher が失敗しても pending が残らず、バックオフ後に再試行できる', async () => {
    const store = useEmojisStore()
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue([emoji('meow')])
    store.ensureLoaded(HOST, fetcher)
    await flush()
    expect(store.resolve(HOST, 'meow')).toBeNull()

    // バックオフ (30s) 前は再試行しない
    store.ensureLoaded(HOST, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(31_000)
    store.ensureLoaded(HOST, fetcher)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(store.resolve(HOST, 'meow')).toBe(`https://${HOST}/files/meow.webp`)
  })

  it('localStorage に v2 形式で永続化し、別インスタンスで復元できる', async () => {
    const store = useEmojisStore()
    const fetcher = vi.fn().mockResolvedValue([emoji('meow')])
    store.ensureLoaded(HOST, fetcher)
    await flush()
    // persist は debounce される
    await vi.advanceTimersByTimeAsync(1_000)

    setActivePinia(createPinia())
    const restored = useEmojisStore()
    expect(restored.resolve(HOST, 'meow')).toBe(
      `https://${HOST}/files/meow.webp`,
    )
  })

  it('旧形式 (v1) の localStorage は捨てて再取得に任せる', () => {
    localStorage.setItem(
      'emojis_cache',
      JSON.stringify({ [HOST]: { meow: 'https://old.example/meow.webp' } }),
    )
    const store = useEmojisStore()
    expect(store.resolve(HOST, 'meow')).toBeNull()
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerEmoji } from '@/adapters/types'
import { useEmojisStore } from '@/stores/emojis'

/** テストごとに上書きするノブ。指定しないキーは 10 */
const perf: Record<string, number> = {}

vi.mock('@/stores/performance', () => ({
  usePerformanceStore: () => ({
    get: (key: string) => perf[key] ?? 10,
  }),
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
    for (const key of Object.keys(perf)) delete perf[key]
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

  it('hosts を欠く v2 の localStorage でもストアが初期化できる', () => {
    localStorage.setItem('emojis_cache', JSON.stringify({ version: 2 }))
    const store = useEmojisStore()
    expect(store.resolve(HOST, 'meow')).toBeNull()
  })

  describe('push 反映 (applyServerChange #889)', () => {
    it('added: 取得済み host の辞書とピッカーリストへ即反映する', async () => {
      const store = useEmojisStore()
      store.ensureLoaded(HOST, vi.fn().mockResolvedValue([emoji('old')]))
      await flush()

      store.applyServerChange(HOST, 'added', [emoji('brand_new')])

      expect(store.resolve(HOST, 'brand_new')).toBe(
        `https://${HOST}/files/brand_new.webp`,
      )
      expect(store.getEmojiList(HOST).map((e) => e.name)).toEqual([
        'old',
        'brand_new',
      ])
    })

    it('updated: 画像 URL の差し替えが miss を経ずに反映される', async () => {
      // 名前は解決できるため miss にならず、pull 型では経年リフレッシュまで
      // 最大 24 時間古い画像が表示され続けていたケース
      const store = useEmojisStore()
      store.ensureLoaded(HOST, vi.fn().mockResolvedValue([emoji('meow')]))
      await flush()

      const v2 = `https://${HOST}/files/meow-v2.webp`
      store.applyServerChange(HOST, 'updated', [
        { name: 'meow', url: v2, category: null, aliases: [] },
      ])

      expect(store.resolve(HOST, 'meow')).toBe(v2)
      expect(store.getEmojiList(HOST).find((e) => e.name === 'meow')?.url).toBe(
        v2,
      )
    })

    it('deleted: 辞書から消え、以後の reportMiss は refetch を起こさない', async () => {
      const store = useEmojisStore()
      const fetcher = vi.fn().mockResolvedValue([emoji('meow')])
      store.ensureLoaded(HOST, fetcher)
      await flush()

      store.applyServerChange(HOST, 'deleted', [emoji('meow')])

      expect(store.resolve(HOST, 'meow')).toBeNull()
      expect(store.getEmojiList(HOST)).toEqual([])
      // 削除済みと分かっているので miss 駆動の空振り refetch を起こさない
      store.reportMiss(HOST, 'meow')
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('deleted 後に added が来たら復活する (unknown の解放)', async () => {
      const store = useEmojisStore()
      store.ensureLoaded(HOST, vi.fn().mockResolvedValue([emoji('meow')]))
      await flush()

      store.applyServerChange(HOST, 'deleted', [emoji('meow')])
      expect(store.resolve(HOST, 'meow')).toBeNull()

      store.applyServerChange(HOST, 'added', [emoji('meow')])
      expect(store.resolve(HOST, 'meow')).toBe(
        `https://${HOST}/files/meow.webp`,
      )
    })

    it('未取得の host には適用しない (次の ensureLoaded が全量を取る)', () => {
      const store = useEmojisStore()
      store.applyServerChange(HOST, 'added', [emoji('meow')])
      expect(store.has(HOST)).toBe(false)
      expect(store.resolve(HOST, 'meow')).toBeNull()
    })
  })

  describe('メモリ上限 (#987)', () => {
    it('emojiCachePerHost を超えた絵文字は辞書に載せない', async () => {
      perf.emojiCachePerHost = 2
      const store = useEmojisStore()
      store.ensureLoaded(
        HOST,
        vi.fn().mockResolvedValue([emoji('a'), emoji('b'), emoji('c')]),
      )
      await flush()

      expect(store.resolve(HOST, 'a')).not.toBeNull()
      expect(store.resolve(HOST, 'b')).not.toBeNull()
      expect(store.resolve(HOST, 'c')).toBeNull()
    })

    it('emojiCacheHosts を超えたら古い host の辞書から捨てる', async () => {
      perf.emojiCacheHosts = 2
      const store = useEmojisStore()
      for (const host of ['a.example', 'b.example', 'c.example']) {
        store.ensureLoaded(host, vi.fn().mockResolvedValue([emoji('meow')]))
        await flush()
      }

      expect(store.has('a.example')).toBe(false)
      expect(store.has('b.example')).toBe(true)
      expect(store.has('c.example')).toBe(true)
    })

    it('落とした host は再び ensureLoaded で取り直せる', async () => {
      perf.emojiCacheHosts = 1
      const store = useEmojisStore()
      store.ensureLoaded('a.example', vi.fn().mockResolvedValue([emoji('a')]))
      await flush()
      store.ensureLoaded('b.example', vi.fn().mockResolvedValue([emoji('b')]))
      await flush()
      expect(store.has('a.example')).toBe(false)

      const refetch = vi.fn().mockResolvedValue([emoji('a')])
      store.ensureLoaded('a.example', refetch)
      await flush()
      expect(refetch).toHaveBeenCalledTimes(1)
      expect(store.resolve('a.example', 'a')).not.toBeNull()
    })

    it('localStorage には emojiPersistPerHost 件までしか保存しない', async () => {
      perf.emojiPersistPerHost = 1
      const store = useEmojisStore()
      store.ensureLoaded(
        HOST,
        vi.fn().mockResolvedValue([emoji('a'), emoji('b')]),
      )
      await flush()
      await vi.advanceTimersByTimeAsync(1_000)

      const raw = localStorage.getItem('emojis_cache') ?? '{}'
      const saved = JSON.parse(raw) as {
        hosts: Record<string, { emojis: Record<string, string> }>
      }
      expect(Object.keys(saved.hosts[HOST]?.emojis ?? {})).toEqual(['a'])
      // メモリ側は絞らない (永続化は解決の一部を運ぶだけ)
      expect(store.resolve(HOST, 'b')).not.toBeNull()
    })

    it('保存済み host が上限を超えていても、復元は上限までで止める', () => {
      perf.emojiCacheHosts = 1
      localStorage.setItem(
        'emojis_cache',
        JSON.stringify({
          version: 2,
          hosts: {
            'a.example': { fetchedAt: 1, emojis: { meow: 'https://a/1.webp' } },
            'b.example': { fetchedAt: 2, emojis: { meow: 'https://b/1.webp' } },
          },
        }),
      )
      const store = useEmojisStore()

      expect(store.has('a.example')).toBe(false)
      expect(store.has('b.example')).toBe(true)
    })
  })

  it('壊れた host エントリは飛ばし、正常な分だけ復元する', () => {
    localStorage.setItem(
      'emojis_cache',
      JSON.stringify({
        version: 2,
        hosts: {
          'broken.example': { fetchedAt: 0 },
          [HOST]: {
            fetchedAt: 1,
            emojis: { meow: `https://${HOST}/files/meow.webp` },
          },
        },
      }),
    )
    const store = useEmojisStore()
    expect(store.resolve('broken.example', 'meow')).toBeNull()
    expect(store.resolve(HOST, 'meow')).toBe(`https://${HOST}/files/meow.webp`)
  })
})

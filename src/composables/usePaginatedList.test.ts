import { describe, expect, it, vi } from 'vitest'
import { usePaginatedList } from './usePaginatedList'

interface Item {
  id: string
  label?: string
}

function makeItems(count: number, offset = 0): Item[] {
  return Array.from({ length: count }, (_, i) => ({ id: `id-${offset + i}` }))
}

describe('usePaginatedList', () => {
  describe('load (初回ロード)', () => {
    it('fetch の結果を items に格納し、pageSize 以上なら hasMore が立つ', async () => {
      const fetch = vi.fn().mockResolvedValue(makeItems(10))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()

      expect(fetch).toHaveBeenCalledWith(undefined)
      expect(list.items.value).toHaveLength(10)
      expect(list.hasMore.value).toBe(true)
      expect(list.isLoading.value).toBe(false)
      expect(list.error.value).toBeNull()
    })

    it('pageSize 未満なら hasMore は立たない', async () => {
      const fetch = vi.fn().mockResolvedValue(makeItems(3))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()

      expect(list.hasMore.value).toBe(false)
    })

    it('2 回目の load は何もしない (once ガード)', async () => {
      const fetch = vi.fn().mockResolvedValue(makeItems(10))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()
      await list.load()

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('失敗時は error が立ち、再 load で retry できる', async () => {
      const fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(makeItems(5))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()
      expect(list.error.value).toContain('network down')
      expect(list.items.value).toHaveLength(0)

      await list.load()
      expect(list.error.value).toBeNull()
      expect(list.items.value).toHaveLength(5)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('pageSize 省略時は「1 件以上あれば hasMore」(reactions パターン)', async () => {
      const fetch = vi.fn().mockResolvedValue(makeItems(2))
      const list = usePaginatedList<Item>({ fetch })

      await list.load()

      expect(list.hasMore.value).toBe(true)
    })

    it('initialHasMore で初回の hasMore 判定を上書きできる (clips パターン)', async () => {
      const fetch = vi.fn().mockResolvedValue(makeItems(10))
      const list = usePaginatedList<Item>({
        fetch,
        pageSize: 10,
        initialHasMore: () => false,
      })

      await list.load()

      expect(list.hasMore.value).toBe(false)
    })
  })

  describe('loadMore (追加ロード)', () => {
    it('最後の item の id を untilId に渡し、結果を追記する', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(10))
        .mockResolvedValueOnce(makeItems(10, 10))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()
      await list.loadMore()

      expect(fetch).toHaveBeenLastCalledWith('id-9')
      expect(list.items.value).toHaveLength(20)
      expect(list.hasMore.value).toBe(true)
    })

    it('pageSize 未満を受け取ったら hasMore=false で打ち切る', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(10))
        .mockResolvedValueOnce(makeItems(4, 10))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()
      await list.loadMore()

      expect(list.items.value).toHaveLength(14)
      expect(list.hasMore.value).toBe(false)
    })

    it('hasMore=false のときは fetch しない', async () => {
      const fetch = vi.fn().mockResolvedValue(makeItems(3))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()
      await list.loadMore()

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('isLoading 中の並行呼び出しは無視される', async () => {
      let resolveSecond: ((items: Item[]) => void) | undefined
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(10))
        .mockImplementationOnce(
          () => new Promise<Item[]>((r) => (resolveSecond = r)),
        )
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()
      const first = list.loadMore()
      const second = list.loadMore() // isLoading 中 → no-op
      resolveSecond?.(makeItems(10, 10))
      await Promise.all([first, second])

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(list.items.value).toHaveLength(20)
    })

    it('失敗時は error が立ち items は変化しない', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(10))
        .mockRejectedValueOnce(new Error('boom'))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()
      await list.loadMore()

      expect(list.error.value).toContain('boom')
      expect(list.items.value).toHaveLength(10)
      // エラーは打ち切りではない — retry できるよう hasMore は維持
      expect(list.hasMore.value).toBe(true)
    })

    it('cursor でカーソル取得をカスタムできる', async () => {
      interface Custom {
        key: string
      }
      const fetch = vi
        .fn()
        .mockResolvedValueOnce([{ key: 'a' }, { key: 'b' }])
        .mockResolvedValueOnce([])
      const list = usePaginatedList<Custom>({
        fetch,
        cursor: (items) => items.at(-1)?.key,
      })

      await list.load()
      await list.loadMore()

      expect(fetch).toHaveBeenLastCalledWith('b')
    })

    it('offset 式: cursor に items.length を返せば次ページの offset になる', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(30))
        .mockResolvedValueOnce(makeItems(30, 30))
      const list = usePaginatedList<Item, number>({
        fetch,
        pageSize: 30,
        cursor: (items) => items.length,
      })

      await list.load()
      expect(fetch).toHaveBeenLastCalledWith(undefined)
      await list.loadMore()

      expect(fetch).toHaveBeenLastCalledWith(30)
      expect(list.items.value).toHaveLength(60)
    })
  })

  describe('maxItems', () => {
    it('items が上限に達したら loadMore は fetch しない', async () => {
      const fetch = vi.fn().mockResolvedValue(makeItems(10))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10, maxItems: 10 })

      await list.load()
      await list.loadMore()

      expect(fetch).toHaveBeenCalledTimes(1)
      expect(list.items.value).toHaveLength(10)
    })

    it('上限未満なら loadMore できる', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(10))
        .mockResolvedValueOnce(makeItems(10, 10))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10, maxItems: 15 })

      await list.load()
      await list.loadMore()

      expect(list.items.value).toHaveLength(20)
    })
  })

  describe('onError', () => {
    it('load 失敗時に raw error を渡して呼ばれる (error ref も立つ)', async () => {
      const cause = new Error('boom')
      const fetch = vi.fn().mockRejectedValue(cause)
      const onError = vi.fn()
      const list = usePaginatedList<Item>({ fetch, onError })

      await list.load()

      expect(onError).toHaveBeenCalledWith(cause)
      expect(list.error.value).toContain('boom')
    })

    it('loadMore 失敗時にも呼ばれる', async () => {
      const cause = new Error('later')
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(10))
        .mockRejectedValueOnce(cause)
      const onError = vi.fn()
      const list = usePaginatedList<Item>({ fetch, pageSize: 10, onError })

      await list.load()
      await list.loadMore()

      expect(onError).toHaveBeenCalledWith(cause)
    })
  })

  describe('reset', () => {
    it('状態を初期化し、load し直せる', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(10))
        .mockResolvedValueOnce(makeItems(5, 100))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })

      await list.load()
      list.reset()

      expect(list.items.value).toHaveLength(0)
      expect(list.hasMore.value).toBe(false)
      expect(list.error.value).toBeNull()

      await list.load()
      expect(list.items.value.map((i) => i.id)).toContain('id-100')
    })
  })

  describe('reload', () => {
    it('表示中の items を保ったまま先頭ページを取り直し、成功したら差し替える', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(10))
        .mockResolvedValueOnce(makeItems(10, 100))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })
      await list.load()

      const reloading = list.reload()
      // 取り直し中も旧 items は残る (カラムの引いて更新で画面を空にしない)
      expect(list.isLoading.value).toBe(true)
      expect(list.items.value).toHaveLength(10)
      await reloading

      expect(fetch).toHaveBeenLastCalledWith(undefined)
      expect(list.items.value[0]?.id).toBe('id-100')
      expect(list.hasMore.value).toBe(true)
    })

    it('失敗したら items は変えず error だけ立つ', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(makeItems(3))
        .mockRejectedValueOnce(new Error('boom'))
      const list = usePaginatedList<Item>({ fetch, pageSize: 10 })
      await list.load()

      await list.reload()

      expect(list.items.value).toHaveLength(3)
      expect(list.error.value).toContain('boom')
    })
  })
})

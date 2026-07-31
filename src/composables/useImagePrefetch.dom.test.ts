import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'

vi.mock('@/stores/performance', () => ({
  usePerformanceStore: () => ({
    get: (key: string) => (key === 'cssBlurLevel' ? 5 : 500),
  }),
}))

/** new Image() を記録するスタブ。onload/onerror を後から発火できる */
class FakeImage {
  static instances: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private _src = ''
  constructor() {
    FakeImage.instances.push(this)
  }
  set src(v: string) {
    this._src = v
  }
  get src() {
    return this._src
  }
}

function note(id: string, fileCount: number): NormalizedNote {
  return {
    renote: null,
    text: id,
    files: Array.from({ length: fileCount }, (_, i) => ({
      type: 'image/png',
      isSensitive: false,
      thumbnailUrl: `https://media.example/${id}-${i}.png`,
      url: `https://media.example/${id}-${i}-orig.png`,
    })),
  } as unknown as NormalizedNote
}

async function loadModule() {
  vi.resetModules()
  return await import('@/composables/useImagePrefetch')
}

describe('prefetchNoteImages の同時実行絞り', () => {
  beforeEach(() => {
    FakeImage.instances = []
    vi.stubGlobal('Image', FakeImage)
  })

  it('同時に発火する Image は上限までに絞られる', async () => {
    const { prefetchNoteImages } = await loadModule()
    prefetchNoteImages([note('a', 4), note('b', 4), note('c', 4)])
    // 12 件エンキューされるが、同時に走るのは 4 件まで
    expect(FakeImage.instances.length).toBe(4)
  })

  it('完了 (load/error) するたびに次をキューから流す', async () => {
    const { prefetchNoteImages } = await loadModule()
    prefetchNoteImages([note('a', 4), note('b', 4)])
    expect(FakeImage.instances.length).toBe(4)

    FakeImage.instances[0]?.onload?.()
    expect(FakeImage.instances.length).toBe(5)

    FakeImage.instances[1]?.onerror?.()
    expect(FakeImage.instances.length).toBe(6)
  })

  it('同じ URL は一度しかプリフェッチしない', async () => {
    const { prefetchNoteImages } = await loadModule()
    prefetchNoteImages([note('a', 2)])
    prefetchNoteImages([note('a', 2)])
    // 2 回呼んでも Image は 2 件 (dedup)
    expect(FakeImage.instances.length).toBe(2)
  })

  it('キュー溢れで捨てた URL は「先読み済み」からも外れ、後で再度先読みできる (#893)', async () => {
    const { prefetchNoteImages } = await loadModule()
    // 105 件: 先頭 4 件が即実行、100 件でキューが埋まり、105 件目の投入で
    // 最古のキュー項目 (x-4) が捨てられる
    prefetchNoteImages([note('x', 105)])
    expect(FakeImage.instances.length).toBe(4)

    // 全件完了させてキューを流し切る (捨てられた x-4 は一度も取得されない)
    for (let i = 0; i < FakeImage.instances.length; i++) {
      FakeImage.instances[i]?.onload?.()
    }
    expect(FakeImage.instances.length).toBe(104)
    const droppedUrl = encodeURIComponent('https://media.example/x-4.png')
    expect(
      FakeImage.instances.some((img) => img.src.includes(droppedUrl)),
    ).toBe(false)

    // 捨てられた URL を含むノートが再び近づいたら、先読みし直せる
    prefetchNoteImages([
      {
        renote: null,
        text: 'y',
        files: [
          {
            type: 'image/png',
            isSensitive: false,
            thumbnailUrl: 'https://media.example/x-4.png',
            url: 'https://media.example/x-4-orig.png',
          },
        ],
      } as unknown as NormalizedNote,
    ])
    expect(FakeImage.instances.length).toBe(105)
    expect(FakeImage.instances.at(-1)?.src).toContain(droppedUrl)
  })
})

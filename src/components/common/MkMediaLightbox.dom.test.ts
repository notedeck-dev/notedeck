import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h, ref } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'

const menuOpenMock = vi.fn()

// DOM API 依存の composable は挙動対象外なのでスタブする
vi.mock('@/composables/usePinchZoom', () => ({
  usePinchZoom: () => ({
    transformStyle: ref(undefined),
    zoomed: ref(false),
    reset: vi.fn(),
  }),
}))
vi.mock('@/composables/useSwipeTab', () => ({ useSwipeTab: () => undefined }))
vi.mock('@/composables/usePortal', () => ({ usePortal: () => undefined }))
vi.mock('@/composables/useBackButton', () => ({
  useBackButton: () => undefined,
}))
vi.mock('@/composables/useLongPress', () => ({
  useLongPress: () => ({ handlers: {} }),
}))
const systemState = vi.hoisted(() => ({ suppressPrefetch: false }))
vi.mock('@/stores/systemState', () => ({
  useSystemStateStore: () => ({ adaptation: systemState }),
}))
vi.mock('./PopupMenu.vue', () => ({
  default: defineComponent({
    setup(_, { slots, expose }) {
      expose({ open: menuOpenMock, close: vi.fn() })
      return () => h('div', { class: 'popup-stub' }, slots.default?.())
    },
  }),
}))

import MkMediaLightbox from './MkMediaLightbox.vue'

function proxied(url: string): string {
  return `http://127.0.0.1:19820/proxy/image?url=${encodeURIComponent(url)}`
}

function makeImage(id: string): NormalizedDriveFile {
  return {
    id,
    name: `${id}.png`,
    type: 'image/png',
    url: `https://example.test/${id}.png`,
    thumbnailUrl: null,
    size: 1,
    isSensitive: false,
    comment: null,
    width: null,
    height: null,
    blurhash: null,
  }
}

let app: App | null = null
let container: HTMLElement | null = null

function mountLightbox(files: NormalizedDriveFile[], initialIndex = 0) {
  container = document.createElement('div')
  document.body.appendChild(container)
  let closed = 0
  app = createApp(MkMediaLightbox, {
    files,
    initialIndex,
    onClose: () => closed++,
  })
  app.mount(container)
  return { getClosed: () => closed }
}

function currentImage(): HTMLImageElement | null {
  return container?.querySelector('img') ?? null
}

function navButtons(): HTMLButtonElement[] {
  // 閉じるボタン以外の SVG ナビボタン（left/right style を持つ）
  return Array.from(container?.querySelectorAll('button') ?? []).filter(
    (b) => b.style.left === '16px' || b.style.right === '16px',
  )
}

function dots(): HTMLElement[] {
  return Array.from(
    container?.querySelectorAll('button[class*="lightboxDot"]') ?? [],
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('MkMediaLightbox (#792)', () => {
  it('1 件のとき prev/next とドットを DOM に描画しない', () => {
    mountLightbox([makeImage('a')])
    expect(navButtons()).toHaveLength(0)
    expect(dots()).toHaveLength(0)
    expect(currentImage()?.src).toContain('a.png')
  })

  it('複数件で next/prev により画像が切り替わる', async () => {
    mountLightbox([makeImage('a'), makeImage('b')], 0)
    // 先頭では next のみ
    expect(navButtons()).toHaveLength(1)
    navButtons()[0]?.click()
    await vi.waitFor(() => expect(currentImage()?.src).toContain('b.png'))
    // 末尾では prev のみ
    expect(navButtons()).toHaveLength(1)
    navButtons()[0]?.click()
    await vi.waitFor(() => expect(currentImage()?.src).toContain('a.png'))
  })

  it('initialIndex から表示を開始する', () => {
    mountLightbox([makeImage('a'), makeImage('b'), makeImage('c')], 2)
    expect(currentImage()?.src).toContain('c.png')
  })

  it('ドットクリックで任意の画像へ移動する', async () => {
    mountLightbox([makeImage('a'), makeImage('b'), makeImage('c')], 0)
    expect(dots()).toHaveLength(3)
    dots()[2]?.click()
    await vi.waitFor(() => expect(currentImage()?.src).toContain('c.png'))
  })

  it('オーバーレイクリックと Escape で close が emit される', () => {
    const { getClosed } = mountLightbox([makeImage('a')])
    ;(container?.firstElementChild as HTMLElement)?.click()
    expect(getClosed()).toBe(1)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(getClosed()).toBe(2)
  })

  it('ArrowRight / ArrowLeft キーで画像が切り替わる', async () => {
    mountLightbox([makeImage('a'), makeImage('b')], 0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await vi.waitFor(() => expect(currentImage()?.src).toContain('b.png'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await vi.waitFor(() => expect(currentImage()?.src).toContain('a.png'))
  })

  it('画像の contextmenu でメニューが開く（抽出回帰）', () => {
    mountLightbox([makeImage('a')])
    const e = new MouseEvent('contextmenu', { cancelable: true })
    currentImage()?.dispatchEvent(e)
    expect(menuOpenMock).toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true)
  })

  it('メニュー項目にコピー / ダウンロード / リンク / ブラウザーで開くがある', () => {
    mountLightbox([makeImage('a')])
    const labels = Array.from(
      container?.querySelectorAll('button._popupItem') ?? [],
    ).map((b) => b.textContent?.trim())
    expect(labels).toContain('画像をコピー')
    expect(labels).toContain('画像をダウンロード')
    expect(labels).toContain('画像のリンクをコピー')
    expect(labels).toContain('ブラウザーで開く')
  })

  describe('画像プロキシ経由の表示 (#1214)', () => {
    it('拡大表示の画像は原寸のプロキシ URL で読む', () => {
      mountLightbox([makeImage('a')])
      expect(currentImage()?.getAttribute('src')).toBe(
        proxied('https://example.test/a.png'),
      )
    })

    it('プロキシで読めなかったら元の URL に倒す', async () => {
      mountLightbox([makeImage('a')])
      currentImage()?.dispatchEvent(new Event('error'))
      await vi.waitFor(() =>
        expect(currentImage()?.getAttribute('src')).toBe(
          'https://example.test/a.png',
        ),
      )
    })

    it('動画は標準の controls ではなく独自のプレイヤーで出す', () => {
      mountLightbox([
        {
          ...makeImage('v'),
          type: 'video/mp4',
          url: 'https://example.test/v.mp4',
        },
      ])
      const video = container?.querySelector('video')
      expect(video?.getAttribute('src')).toBe('https://example.test/v.mp4')
      expect(video?.hasAttribute('controls')).toBe(false)
      expect(video?.autoplay).toBe(true)
    })
  })

  describe('隣接画像の先読み (#704 O-3)', () => {
    let preloaded: string[] = []
    class FakeImage {
      set src(v: string) {
        preloaded.push(v)
      }
    }
    beforeEach(() => {
      preloaded = []
      systemState.suppressPrefetch = false
      vi.stubGlobal('Image', FakeImage)
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('前後 1 枚を原寸のプロキシ URL で先読みする', async () => {
      mountLightbox(
        [makeImage('a'), makeImage('b'), makeImage('c'), makeImage('d')],
        1,
      )
      expect(preloaded.sort()).toEqual([
        proxied('https://example.test/a.png'),
        proxied('https://example.test/c.png'),
      ])
      navButtons()[1]?.click()
      await vi.waitFor(() => expect(currentImage()?.src).toContain('c.png'))
      // 移動先の隣 (d) が増える。表示済みの b と先読み済みの c は読み直さない
      expect(preloaded).toContain(proxied('https://example.test/d.png'))
      expect(preloaded).toHaveLength(3)
    })

    it('動画は先読みしない', () => {
      mountLightbox(
        [
          {
            ...makeImage('v'),
            type: 'video/mp4',
            url: 'https://example.test/v.mp4',
          },
          makeImage('b'),
        ],
        1,
      )
      expect(preloaded).toEqual([])
    })

    it('省電力・従量制回線 (suppressPrefetch) では先読みしない', () => {
      systemState.suppressPrefetch = true
      mountLightbox([makeImage('a'), makeImage('b')], 0)
      expect(preloaded).toEqual([])
    })
  })
})

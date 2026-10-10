import { afterEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'

// ライトボックス抽出後の「開く配線」だけを検証する（本体は MkMediaLightbox.dom.test.ts）
const lightboxProps: Array<{ files: NormalizedDriveFile[]; index: number }> = []

vi.mock('./MkMediaLightbox.vue', () => ({
  default: defineComponent({
    props: {
      files: { type: Array, required: true },
      initialIndex: { type: Number, required: true },
    },
    setup(props) {
      lightboxProps.push({
        files: props.files as NormalizedDriveFile[],
        index: props.initialIndex as number,
      })
      return () => h('div', { class: 'lightbox-stub' })
    },
  }),
}))

// 従量制回線の遅延読み込み (#935) は store 経由。pinia を立てずに直接差し込む
const systemState = vi.hoisted(() => ({
  deferMedia: false,
  staticEmoji: false,
}))
vi.mock('@/stores/systemState', () => ({
  useSystemStateStore: () => ({
    adaptation: {
      get deferMedia() {
        return systemState.deferMedia
      },
      get staticEmoji() {
        return systemState.staticEmoji
      },
    },
  }),
}))

// プレイヤーの設定メニュー (#1214) は pinia の store を読むので差し替える
vi.mock('./PopupMenu.vue', () => ({
  default: defineComponent({
    setup(_, { slots, expose }) {
      expose({ open: vi.fn(), close: vi.fn() })
      return () => h('div', { class: 'popup-stub' }, slots.default?.())
    },
  }),
}))

import MkMediaGrid from './MkMediaGrid.vue'

function makeImage(id: string, sensitive = false): NormalizedDriveFile {
  return {
    id,
    name: `${id}.png`,
    type: 'image/png',
    url: `https://example.test/${id}.png`,
    thumbnailUrl: null,
    size: 1,
    isSensitive: sensitive,
    comment: null,
    width: null,
    height: null,
    blurhash: null,
  }
}

let app: App | null = null
let container: HTMLElement | null = null

function mountGrid(files: NormalizedDriveFile[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  lightboxProps.length = 0
  app = createApp(MkMediaGrid, { files })
  app.mount(container)
}

function cells(): HTMLElement[] {
  return Array.from(
    container?.querySelectorAll('div[class*="mediaCell"]') ?? [],
  )
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
  systemState.deferMedia = false
  systemState.staticEmoji = false
})

describe('従量制回線ではタップするまで読まない (#935)', () => {
  it('img を出さずタップ読み込みの口を出し、タップで読み込む', async () => {
    systemState.deferMedia = true
    // 開いた添付はモジュール単位で覚えるので、他のテストと id を分ける
    mountGrid([makeImage('tapped')])
    expect(container?.querySelector('img[src*="tapped.png"]')).toBeNull()
    const overlay = container?.querySelector(
      '._sensitiveOverlay',
    ) as HTMLElement | null
    expect(overlay?.textContent).toContain('タップで読み込み')
    overlay?.click()
    await vi.waitFor(() =>
      expect(container?.querySelector('img[src*="tapped.png"]')).not.toBeNull(),
    )
    // 読み込んだ後は通常どおりライトボックスが開く
    cells()[0]?.click()
    await vi.waitFor(() => expect(lightboxProps).toHaveLength(1))
  })

  it('遅延中のセルはクリックしてもライトボックスが開かない', async () => {
    systemState.deferMedia = true
    mountGrid([makeImage('a')])
    cells()[0]?.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(lightboxProps).toHaveLength(0)
  })
})

describe('MkMediaGrid ライトボックス抽出後の回帰 (#792)', () => {
  it('セルクリックで当該インデックスのライトボックスが開く', async () => {
    mountGrid([makeImage('a'), makeImage('b')])
    cells()[1]?.click()
    await vi.waitFor(() => expect(lightboxProps).toHaveLength(1))
    expect(lightboxProps[0]?.index).toBe(1)
    expect(lightboxProps[0]?.files.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('sensitive 未 reveal のセルはクリックしてもライトボックスが開かない', async () => {
    mountGrid([makeImage('a', true)])
    cells()[0]?.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(lightboxProps).toHaveLength(0)
    expect(container?.querySelector('.lightbox-stub')).toBeNull()
  })
  it('開いた sensitive は作り直しても開いたまま (#704)', async () => {
    mountGrid([makeImage('reopened', true)])
    ;(container?.querySelector('._sensitiveOverlay') as HTMLElement).click()
    await vi.waitFor(() =>
      expect(container?.querySelector('._sensitiveOverlay')).toBeNull(),
    )
    app?.unmount()
    container?.remove()
    mountGrid([makeImage('reopened', true)])
    expect(container?.querySelector('._sensitiveOverlay')).toBeNull()
  })
})

describe('アニメーション画像の再生制御 (#704)', () => {
  function makeGif(id: string): NormalizedDriveFile {
    return {
      ...makeImage(id),
      name: `${id}.gif`,
      type: 'image/gif',
      url: `https://example.test/${id}.gif`,
    }
  }
  function gifImg(): HTMLImageElement | null | undefined {
    return container?.querySelector('img[alt$=".gif"]')
  }
  function toggle(): HTMLButtonElement | null | undefined {
    return container?.querySelector('button[aria-pressed]')
  }

  it('既定では再生し、ボタンで 1 フレーム目に止め、もう一度で再開する', async () => {
    mountGrid([makeGif('anim')])
    expect(gifImg()?.getAttribute('src')).not.toContain('static=1')
    toggle()?.click()
    await vi.waitFor(() =>
      expect(gifImg()?.getAttribute('src')).toContain('static=1'),
    )
    expect(lightboxProps).toHaveLength(0)
    toggle()?.click()
    await vi.waitFor(() =>
      expect(gifImg()?.getAttribute('src')).not.toContain('static=1'),
    )
  })

  it('省電力中は止めた状態で出す', () => {
    systemState.staticEmoji = true
    mountGrid([makeGif('saving')])
    expect(gifImg()?.getAttribute('src')).toContain('static=1')
    expect(toggle()?.getAttribute('aria-pressed')).toBe('false')
  })

  it('静止画にはボタンを出さない', () => {
    mountGrid([makeImage('still')])
    expect(toggle()).toBeNull()
  })
})

describe('動画・音声の独自プレイヤー (#1214)', () => {
  function makeVideo(id: string, thumbnailUrl: string | null) {
    return {
      ...makeImage(id),
      name: `${id}.mp4`,
      type: 'video/mp4',
      url: `https://example.test/${id}.mp4`,
      thumbnailUrl,
    }
  }

  it('動画は標準の controls を出さず、サムネイルをプロキシ経由のポスターにして本体は読まない', () => {
    mountGrid([makeVideo('v', 'https://example.test/v.webp')])
    const video = container?.querySelector('video')
    expect(video?.getAttribute('src')).toBe(
      `http://localhost:19820/proxy/media?url=${encodeURIComponent('https://example.test/v.mp4')}`,
    )
    expect(video?.hasAttribute('controls')).toBe(false)
    expect(video?.getAttribute('preload')).toBe('none')
    const poster = container?.querySelector(
      'img[aria-hidden="true"]:not([class*="blurhash"])',
    )
    expect(poster?.getAttribute('src')).toContain(
      `proxy/image?url=${encodeURIComponent('https://example.test/v.webp')}`,
    )
    expect(container?.querySelector('input[type="range"]')).not.toBeNull()
  })

  it('動画の中継で読めなければ元の URL に戻し、それでも駄目ならエラー表示にする', async () => {
    mountGrid([makeVideo('v', null)])
    container?.querySelector('video')?.dispatchEvent(new Event('error'))
    await vi.waitFor(() =>
      expect(container?.querySelector('video')?.getAttribute('src')).toBe(
        'https://example.test/v.mp4',
      ),
    )
    container?.querySelector('video')?.dispatchEvent(new Event('error'))
    await vi.waitFor(() => expect(container?.querySelector('video')).toBeNull())
  })

  it('サムネイルの無い動画は最初のフレームのためにメタデータだけ読む', () => {
    mountGrid([makeVideo('v', null)])
    expect(container?.querySelector('video')?.getAttribute('preload')).toBe(
      'metadata',
    )
  })

  it('再生ボタンで play() を呼ぶ', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    mountGrid([makeVideo('v', null)])
    const btn = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="再生"]',
    )
    btn?.click()
    expect(play).toHaveBeenCalled()
    play.mockRestore()
  })

  it('音声も標準の controls を出さない', () => {
    mountGrid([
      {
        ...makeImage('a'),
        name: 'a.mp3',
        type: 'audio/mpeg',
        url: 'https://example.test/a.mp3',
      },
    ])
    const audio = container?.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe('https://example.test/a.mp3')
    expect(audio?.hasAttribute('controls')).toBe(false)
    expect(container?.textContent).toContain('a.mp3')
  })
})

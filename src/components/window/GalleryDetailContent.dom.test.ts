import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h } from 'vue'

const lightboxProps: Array<{ ids: string[]; index: number }> = []

vi.mock('@/components/common/MkMediaLightbox.vue', () => ({
  default: defineComponent({
    props: {
      files: { type: Array, required: true },
      initialIndex: { type: Number, required: true },
    },
    setup(props) {
      lightboxProps.push({
        ids: (props.files as { id: string }[]).map((f) => f.id),
        index: props.initialIndex as number,
      })
      return () => h('div', { class: 'lightbox-stub' })
    },
  }),
}))
vi.mock('@/components/common/MkMfm.vue', () => ({
  default: defineComponent({
    props: { text: { type: String, default: '' } },
    setup(props) {
      return () => h('span', props.text as string)
    },
  }),
}))
vi.mock('@/composables/useWindowExternalLink', () => ({
  useWindowExternalLink: () => undefined,
}))
vi.mock('@/utils/tauriInvoke', () => ({
  unwrap: (x: unknown) => x,
  commands: {
    apiLikeGalleryPost: vi.fn(async () => ({ status: 'ok', data: null })),
    apiUnlikeGalleryPost: vi.fn(async () => ({ status: 'ok', data: null })),
  },
}))

import GalleryDetailContent from './GalleryDetailContent.vue'

function makeFile(id: string, sensitive = false) {
  return {
    id,
    name: `${id}.png`,
    type: 'image/png',
    url: `https://example.test/${id}.png`,
    thumbnailUrl: null,
    isSensitive: sensitive,
  }
}

function makePost(files: ReturnType<typeof makeFile>[]) {
  return {
    id: 'p1',
    title: 'タイトル',
    description: null,
    fileIds: files.map((f) => f.id),
    files,
    isSensitive: files.some((f) => f.isSensitive),
    likedCount: 0,
    isLiked: false,
    createdAt: '2026-07-20T00:00:00.000Z',
    user: {
      id: 'u1',
      username: 'alice',
      name: null,
      avatarUrl: null,
      host: null,
    },
  }
}

let app: App | null = null
let container: HTMLElement | null = null

function mountDetail(files: ReturnType<typeof makeFile>[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  lightboxProps.length = 0
  app = createApp(GalleryDetailContent, {
    accountId: 'acc1',
    postId: 'p1',
    post: makePost(files),
  })
  app.mount(container)
}

function viewerImg(): HTMLImageElement | null {
  return container?.querySelector('img[class*="viewerImg"]') ?? null
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('GalleryDetailContent の画像プレビュー (#793)', () => {
  it('画像クリックで当該画像を初期位置にライトボックスが開く', async () => {
    mountDetail([makeFile('a'), makeFile('b')])
    // 2 枚目に移動してからクリック
    const next = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.className.includes('navNext'),
    )
    next?.click()
    await vi.waitFor(() => expect(viewerImg()?.src).toContain('b.png'))
    viewerImg()?.click()
    await vi.waitFor(() => expect(lightboxProps).toHaveLength(1))
    expect(lightboxProps[0]).toEqual({ ids: ['a', 'b'], index: 1 })
  })

  it('sensitive は blur + click-to-reveal、reveal 前はライトボックスが開かない', async () => {
    mountDetail([makeFile('a', true)])
    expect(container?.querySelector('._sensitiveOverlay')).toBeTruthy()
    viewerImg()?.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(lightboxProps).toHaveLength(0)
    // reveal → クリックで開く
    ;(container?.querySelector('._sensitiveOverlay') as HTMLElement)?.click()
    await vi.waitFor(() =>
      expect(container?.querySelector('._sensitiveOverlay')).toBeNull(),
    )
    viewerImg()?.click()
    await vi.waitFor(() => expect(lightboxProps).toHaveLength(1))
  })
})

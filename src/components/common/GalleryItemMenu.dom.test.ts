import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h } from 'vue'
import type { GalleryPost } from '@/bindings'

const copyToClipboardMock = vi.fn()
const openSafeUrlMock = vi.fn()

vi.mock('@/composables/useClipboardFeedback', () => ({
  useClipboardFeedback: () => ({ copyToClipboard: copyToClipboardMock }),
}))
vi.mock('@/utils/url', () => ({
  // vi.mock は hoist されるため、変数参照は呼び出し時まで遅延させる
  openSafeUrl: (url: string) => openSafeUrlMock(url),
  webUiUrl: (host: string, path = '') => `https://${host}${path}`,
}))
vi.mock('@/stores/accounts', () => ({
  useAccountsStore: () => ({
    accounts: [{ id: 'acc1', host: 'misskey.test' }],
  }),
}))
vi.mock('./PopupMenu.vue', () => ({
  default: defineComponent({
    setup(_, { slots, expose }) {
      expose({ open: vi.fn(), close: vi.fn() })
      return () => h('div', { class: 'popup-stub' }, slots.default?.())
    },
  }),
}))

import GalleryItemMenu from './GalleryItemMenu.vue'

const post = {
  id: 'p1',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  title: '投稿',
  description: null,
  userId: 'u1',
  files: [],
} as unknown as GalleryPost

let app: App | null = null
let container: HTMLElement | null = null

function mountMenu(accountId: string | null = 'acc1') {
  container = document.createElement('div')
  document.body.appendChild(container)
  const opened: GalleryPost[] = []
  app = createApp(GalleryItemMenu, {
    post,
    accountId,
    onOpenRequest: (p: GalleryPost) => opened.push(p),
  })
  app.mount(container)
  return opened
}

function clickItem(label: string) {
  const btn = Array.from(
    container?.querySelectorAll('button._popupItem') ?? [],
  ).find((b) => b.textContent?.includes(label)) as HTMLButtonElement
  btn.click()
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

describe('GalleryItemMenu (#793)', () => {
  it('開く / リンクをコピー / ブラウザで開くの 3 項目を持つ', () => {
    mountMenu()
    const labels = Array.from(
      container?.querySelectorAll('button._popupItem') ?? [],
    ).map((b) => b.textContent?.trim())
    expect(labels).toEqual(['開く', 'リンクをコピー', 'ブラウザで開く'])
  })

  it('「開く」で open-request が emit される', () => {
    const opened = mountMenu()
    clickItem('開く')
    expect(opened).toEqual([post])
  })

  it('「リンクをコピー」で投稿の Web URL がコピーされる', async () => {
    mountMenu()
    clickItem('リンクをコピー')
    await vi.waitFor(() =>
      expect(copyToClipboardMock).toHaveBeenCalledWith(
        'https://misskey.test/gallery/p1',
      ),
    )
  })

  it('「ブラウザで開く」で openSafeUrl が呼ばれる', async () => {
    mountMenu()
    clickItem('ブラウザで開く')
    await vi.waitFor(() =>
      expect(openSafeUrlMock).toHaveBeenCalledWith(
        'https://misskey.test/gallery/p1',
      ),
    )
  })

  it('host 不明のときリンク系は disabled', () => {
    mountMenu('unknown-acc')
    const buttons = Array.from(
      container?.querySelectorAll('button._popupItem') ?? [],
    ) as HTMLButtonElement[]
    expect(
      buttons.find((b) => b.textContent?.includes('リンクをコピー'))?.disabled,
    ).toBe(true)
    expect(
      buttons.find((b) => b.textContent?.includes('ブラウザで開く'))?.disabled,
    ).toBe(true)
  })
})

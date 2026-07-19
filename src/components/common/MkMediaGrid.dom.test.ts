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
})

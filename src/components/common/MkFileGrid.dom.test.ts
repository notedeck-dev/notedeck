import { afterEach, describe, expect, it } from 'vitest'
import { type App, createApp, defineComponent, h } from 'vue'
import type { NormalizedDriveFile } from '@/adapters/types'
import MkFileGrid from './MkFileGrid.vue'

function makeFile(id: string): NormalizedDriveFile {
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

const files = [makeFile('f1'), makeFile('f2')]

let app: App | null = null
let container: HTMLElement | null = null

interface Emitted {
  click: NormalizedDriveFile[]
  menu: [NormalizedDriveFile, MouseEvent][]
}

function mountGrid(
  props: Partial<{
    selectMode: boolean
    selectedIds: Set<string>
    showItemMenu: boolean
  }> = {},
  slotContent = false,
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const emitted: Emitted = { click: [], menu: [] }
  const root = defineComponent({
    render() {
      return h(
        MkFileGrid,
        {
          files,
          ...props,
          onFileClick: (file: NormalizedDriveFile) => emitted.click.push(file),
          onFileMenu: (file: NormalizedDriveFile, e: MouseEvent) =>
            emitted.menu.push([file, e]),
        },
        slotContent
          ? {
              default: () => h('button', { id: 'upload-cell' }, 'アップロード'),
            }
          : undefined,
      )
    },
  })
  app = createApp(root)
  app.mount(container)
  return emitted
}

function cellButtons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll('button') ?? []).filter(
    (b) => b.title !== 'メニュー' && b.id !== 'upload-cell',
  )
}

function menuButtons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll('button') ?? []).filter(
    (b) => b.title === 'メニュー',
  )
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('MkFileGrid (#792)', () => {
  it('showItemMenu default false では「…」を描画せず contextmenu も素通り', () => {
    const emitted = mountGrid()
    expect(menuButtons()).toHaveLength(0)
    const e = new MouseEvent('contextmenu', { cancelable: true })
    cellButtons()[0]?.dispatchEvent(e)
    expect(emitted.menu).toHaveLength(0)
    expect(e.defaultPrevented).toBe(false)
  })

  it('showItemMenu で「…」クリックと contextmenu の両経路から file-menu が emit される', () => {
    const emitted = mountGrid({ showItemMenu: true })
    expect(menuButtons()).toHaveLength(2)
    menuButtons()[0]?.click()
    expect(emitted.menu).toHaveLength(1)
    expect(emitted.menu[0]?.[0]).toEqual(files[0])
    const e = new MouseEvent('contextmenu', { cancelable: true })
    cellButtons()[1]?.dispatchEvent(e)
    expect(emitted.menu).toHaveLength(2)
    expect(emitted.menu[1]?.[0]).toEqual(files[1])
    expect(e.defaultPrevented).toBe(true)
  })

  it('selectMode 中は「…」・contextmenu とも無効', () => {
    const emitted = mountGrid({ showItemMenu: true, selectMode: true })
    expect(menuButtons()).toHaveLength(0)
    const e = new MouseEvent('contextmenu', { cancelable: true })
    cellButtons()[0]?.dispatchEvent(e)
    expect(emitted.menu).toHaveLength(0)
    expect(e.defaultPrevented).toBe(false)
  })

  it('セル構造にネスト button が無い（wrapper + 兄弟オーバーレイ）', () => {
    mountGrid({ showItemMenu: true })
    const nested = container?.querySelectorAll('button button') ?? []
    expect(nested).toHaveLength(0)
  })

  it('default slot のセルがグリッド先頭に入る（MkDrivePicker 置換の前提）', () => {
    mountGrid({}, true)
    const grid = container?.firstElementChild
    expect(grid?.firstElementChild?.id).toBe('upload-cell')
  })

  it('file-click は selectMode でも emit される（toggle はホスト責務）', () => {
    const emitted = mountGrid({ selectMode: true })
    cellButtons()[0]?.click()
    expect(emitted.click).toEqual([files[0]])
  })
})

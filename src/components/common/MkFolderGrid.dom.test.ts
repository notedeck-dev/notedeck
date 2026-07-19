import { afterEach, describe, expect, it } from 'vitest'
import { type App, createApp } from 'vue'
import type { DriveFolder } from '@/adapters/types'
import MkFolderGrid from './MkFolderGrid.vue'

const folders: DriveFolder[] = [
  { id: 'fo1', name: 'フォルダA', parentId: null },
  { id: 'fo2', name: 'フォルダB', parentId: null },
]

let app: App | null = null
let container: HTMLElement | null = null

interface Emitted {
  click: DriveFolder[]
  menu: [DriveFolder, MouseEvent][]
}

function mountGrid(
  props: Partial<{
    showItemMenu: boolean
    selectMode: boolean
  }> = {},
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const emitted: Emitted = { click: [], menu: [] }
  app = createApp(MkFolderGrid, {
    folders,
    ...props,
    onFolderClick: (folder: DriveFolder) => emitted.click.push(folder),
    onFolderMenu: (folder: DriveFolder, e: MouseEvent) =>
      emitted.menu.push([folder, e]),
  })
  app.mount(container)
  return emitted
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll('button') ?? [])
}

function menuButtons(): HTMLButtonElement[] {
  return buttons().filter((b) => b.title === 'メニュー')
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('MkFolderGrid (#792)', () => {
  it('フォルダセルのクリックで folder-click が emit される', () => {
    const emitted = mountGrid()
    buttons()[0]?.click()
    expect(emitted.click).toEqual([folders[0]])
  })

  it('デフォルト（props 未指定）では「…」を描画しない', () => {
    mountGrid()
    expect(menuButtons()).toHaveLength(0)
  })

  it('showItemMenu で「…」が描画され folder-menu が emit される', () => {
    const emitted = mountGrid({ showItemMenu: true })
    expect(menuButtons()).toHaveLength(2)
    menuButtons()[1]?.click()
    expect(emitted.menu).toHaveLength(1)
    expect(emitted.menu[0]?.[0]).toEqual(folders[1])
  })

  it('showItemMenu 時は contextmenu でも folder-menu が emit される', () => {
    const emitted = mountGrid({ showItemMenu: true })
    const cell = buttons()[0]
    const e = new MouseEvent('contextmenu', { cancelable: true })
    cell?.dispatchEvent(e)
    expect(emitted.menu).toHaveLength(1)
    expect(e.defaultPrevented).toBe(true)
  })

  it('showItemMenu false では contextmenu が素通り（preventDefault されない）', () => {
    const emitted = mountGrid()
    const e = new MouseEvent('contextmenu', { cancelable: true })
    buttons()[0]?.dispatchEvent(e)
    expect(emitted.menu).toHaveLength(0)
    expect(e.defaultPrevented).toBe(false)
  })

  it('selectMode 中は「…」非描画かつ contextmenu で emit されない', () => {
    const emitted = mountGrid({
      showItemMenu: true,
      selectMode: true,
    })
    expect(menuButtons()).toHaveLength(0)
    const e = new MouseEvent('contextmenu', { cancelable: true })
    buttons()[0]?.dispatchEvent(e)
    expect(emitted.menu).toHaveLength(0)
    expect(e.defaultPrevented).toBe(false)
  })

  it('selectMode 中もフォルダクリック（ナビゲーション）は emit される', () => {
    const emitted = mountGrid({ selectMode: true })
    buttons()[1]?.click()
    expect(emitted.click).toEqual([folders[1]])
  })
})

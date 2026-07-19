import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h } from 'vue'
import type { DriveFolder, NormalizedDriveFile } from '@/adapters/types'

const renameFolderMock = vi.fn()
const deleteFolderMock = vi.fn()
const renameFileMock = vi.fn()
const deleteFileMock = vi.fn<() => Promise<boolean>>()

vi.mock('@/composables/useDriveActions', () => ({
  useDriveActions: () => ({
    renameFolder: renameFolderMock,
    deleteFolder: deleteFolderMock,
    renameFile: renameFileMock,
    deleteFile: deleteFileMock,
  }),
}))

// PopupMenu は popover / dialog / store 依存が重いのでスタブし、
// メニュー項目 (slot) の構成と配線だけを検証する
vi.mock('./PopupMenu.vue', () => ({
  default: defineComponent({
    setup(_, { slots, expose }) {
      expose({ open: vi.fn(), close: vi.fn() })
      return () => h('div', { class: 'popup-stub' }, slots.default?.())
    },
  }),
}))

import DriveItemMenu from './DriveItemMenu.vue'

const file: NormalizedDriveFile = {
  id: 'f1',
  name: 'photo.png',
  type: 'image/png',
  url: 'https://example.test/photo.png',
  thumbnailUrl: null,
  size: 1,
  isSensitive: false,
  comment: null,
  width: null,
  height: null,
  blurhash: null,
}
const folder: DriveFolder = { id: 'fo1', name: 'フォルダ', parentId: null }

let app: App | null = null
let container: HTMLElement | null = null

interface Emitted {
  open: (NormalizedDriveFile | DriveFolder)[]
  move: NormalizedDriveFile[]
  deleted: NormalizedDriveFile[]
}

function mountMenu(props: {
  kind: 'file' | 'folder'
  item: NormalizedDriveFile | DriveFolder
  context: 'grid' | 'detail'
}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const emitted: Emitted = { open: [], move: [], deleted: [] }
  app = createApp(DriveItemMenu, {
    ...props,
    accountId: 'acc1',
    onOpenRequest: (item: NormalizedDriveFile | DriveFolder) =>
      emitted.open.push(item),
    onMoveRequest: (item: NormalizedDriveFile) => emitted.move.push(item),
    onDeleted: (item: NormalizedDriveFile) => emitted.deleted.push(item),
  })
  app.mount(container)
  return emitted
}

function itemLabels(): string[] {
  return Array.from(container?.querySelectorAll('button._popupItem') ?? []).map(
    (b) => b.textContent?.trim() ?? '',
  )
}

function clickItem(label: string) {
  const btn = Array.from(
    container?.querySelectorAll('button._popupItem') ?? [],
  ).find((b) => b.textContent?.trim() === label) as HTMLButtonElement
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

describe('DriveItemMenu (#792)', () => {
  it('grid+file: 開く / リネーム / 移動 / 削除', () => {
    mountMenu({ kind: 'file', item: file, context: 'grid' })
    expect(itemLabels()).toEqual(['開く', 'リネーム', '移動', '削除'])
  })

  it('grid+folder: 開く / リネーム / 削除（移動なし）', () => {
    mountMenu({ kind: 'folder', item: folder, context: 'grid' })
    expect(itemLabels()).toEqual(['開く', 'リネーム', '削除'])
  })

  it('detail+file: リネーム / 移動 / 削除（開くなし）', () => {
    mountMenu({ kind: 'file', item: file, context: 'detail' })
    expect(itemLabels()).toEqual(['リネーム', '移動', '削除'])
  })

  it('削除項目は danger スタイル', () => {
    mountMenu({ kind: 'file', item: file, context: 'grid' })
    const danger = container?.querySelector('button._popupItemDanger')
    expect(danger?.textContent?.trim()).toBe('削除')
  })

  it('「開く」で open-request、「移動」で move-request が emit される', () => {
    const emitted = mountMenu({ kind: 'file', item: file, context: 'grid' })
    clickItem('開く')
    expect(emitted.open).toEqual([file])
    clickItem('移動')
    expect(emitted.move).toEqual([file])
  })

  it('リネームは kind に応じて useDriveActions を呼ぶ', () => {
    mountMenu({ kind: 'folder', item: folder, context: 'grid' })
    clickItem('リネーム')
    expect(renameFolderMock).toHaveBeenCalledWith('acc1', folder)
    app?.unmount()
    container?.remove()
    mountMenu({ kind: 'file', item: file, context: 'grid' })
    clickItem('リネーム')
    expect(renameFileMock).toHaveBeenCalledWith('acc1', file)
  })

  it('ファイル削除成功で deleted が emit される（失敗では emit されない）', async () => {
    deleteFileMock.mockResolvedValueOnce(true)
    const emitted = mountMenu({ kind: 'file', item: file, context: 'detail' })
    clickItem('削除')
    await vi.waitFor(() => expect(emitted.deleted).toEqual([file]))

    deleteFileMock.mockResolvedValueOnce(false)
    clickItem('削除')
    await new Promise((r) => setTimeout(r, 0))
    expect(emitted.deleted).toHaveLength(1)
  })

  it('フォルダ削除は deleteFolder を呼ぶ', () => {
    mountMenu({ kind: 'folder', item: folder, context: 'grid' })
    clickItem('削除')
    expect(deleteFolderMock).toHaveBeenCalledWith('acc1', folder)
  })
})

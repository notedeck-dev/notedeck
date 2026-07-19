import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import type { DriveFolder } from '@/adapters/types'

const createFolderMock = vi.fn<() => Promise<DriveFolder | null>>()

vi.mock('@/composables/useDriveActions', () => ({
  useDriveActions: () => ({ createFolder: createFolderMock }),
}))

// happy-dom に無い <dialog> showModal / popover 依存を外し、構成と配線を検証する
vi.mock('@/composables/useNativeDialog', () => ({
  useNativeDialog: () => undefined,
}))
vi.mock('@/composables/useBackButton', () => ({
  useBackButton: () => undefined,
}))
vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ getStyleVarsForAccount: () => ({}) }),
}))

const foldersByParent: Record<string, DriveFolder[]> = {
  root: [{ id: 'c1', name: '子フォルダ', parentId: null }],
  c1: [{ id: 'g1', name: '孫フォルダ', parentId: 'c1' }],
}

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiGetDriveFolders: vi.fn(
        async (_acc: string, folderId: string | null) => ({
          status: 'ok',
          data: foldersByParent[folderId ?? 'root'] ?? [],
        }),
      ),
      apiGetDriveFiles: vi.fn(async () => ({ status: 'ok', data: [] })),
    },
  }
})

import MkDriveFolderSelectDialog from './MkDriveFolderSelectDialog.vue'

let app: App | null = null
let container: HTMLElement | null = null

interface Emitted {
  confirm: (string | null)[]
  cancel: number
}

async function mountDialog(
  props: Partial<{
    initialFolderId: string | null
    initialStack: DriveFolder[]
  }> = {},
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const emitted: Emitted = { confirm: [], cancel: 0 }
  app = createApp(MkDriveFolderSelectDialog, {
    accountId: 'acc1',
    ...props,
    onConfirm: (folderId: string | null) => emitted.confirm.push(folderId),
    onCancel: () => emitted.cancel++,
  })
  app.mount(container)
  // fetchDrive の解決（スピナー消滅）を待つ
  await vi.waitFor(() => {
    expect(container?.innerHTML).not.toContain('_spinner')
  })
  await nextTick()
  return emitted
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container?.querySelectorAll('button') ?? []).find((b) =>
    b.textContent?.includes(text),
  )
}

function createCellButton(): HTMLButtonElement | undefined {
  return Array.from(container?.querySelectorAll('button') ?? []).find(
    (b) => b.getAttribute('aria-label') === '新規フォルダ',
  )
}

function okButton(): HTMLButtonElement | undefined {
  return buttonByText('に移動')
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

describe('MkDriveFolderSelectDialog (#792)', () => {
  it('ルート開始: 確定ラベルは「ルートに移動」、確定で null を emit', async () => {
    const emitted = await mountDialog()
    expect(okButton()?.textContent).toContain('ルートに移動')
    okButton()?.click()
    await vi.waitFor(() => expect(emitted.confirm).toEqual([null]))
  })

  it('initialFolderId / initialStack から開始し、確定でその folderId を emit', async () => {
    const stack: DriveFolder[] = [
      { id: 'c1', name: '子フォルダ', parentId: null },
    ]
    const emitted = await mountDialog({
      initialFolderId: 'c1',
      initialStack: stack,
    })
    expect(okButton()?.textContent).toContain('「子フォルダ」に移動')
    okButton()?.click()
    await vi.waitFor(() => expect(emitted.confirm).toEqual(['c1']))
  })

  it('フォルダに潜ってから確定すると当該 folderId を emit（no-op 判定なしで常に emit）', async () => {
    const emitted = await mountDialog()
    buttonByText('子フォルダ')?.click()
    await vi.waitFor(() =>
      expect(okButton()?.textContent).toContain('「子フォルダ」に移動'),
    )
    okButton()?.click()
    await vi.waitFor(() => expect(emitted.confirm).toEqual(['c1']))
  })

  it('ルートボタンで即ルートへ戻れる', async () => {
    const stack: DriveFolder[] = [
      { id: 'c1', name: '子フォルダ', parentId: null },
    ]
    const emitted = await mountDialog({
      initialFolderId: 'c1',
      initialStack: stack,
    })
    const rootBtn = Array.from(
      container?.querySelectorAll('button') ?? [],
    ).find((b) => b.title === 'ルート')
    expect(rootBtn).toBeTruthy()
    rootBtn?.click()
    await vi.waitFor(() =>
      expect(okButton()?.textContent).toContain('ルートに移動'),
    )
    okButton()?.click()
    await vi.waitFor(() => expect(emitted.confirm).toEqual([null]))
  })

  it('ダイアログ内フォルダ作成の成功でレスポンス由来の auto-descend', async () => {
    createFolderMock.mockResolvedValueOnce({
      id: 'new1',
      name: '新フォルダX',
      parentId: null,
    })
    const emitted = await mountDialog()
    createCellButton()?.click()
    await vi.waitFor(() =>
      expect(okButton()?.textContent).toContain('「新フォルダX」に移動'),
    )
    okButton()?.click()
    await vi.waitFor(() => expect(emitted.confirm).toEqual(['new1']))
  })

  it('作成キャンセル（null 戻り）では現階層に留まる', async () => {
    createFolderMock.mockResolvedValueOnce(null)
    await mountDialog()
    createCellButton()?.click()
    await nextTick()
    expect(okButton()?.textContent).toContain('ルートに移動')
  })

  it('キャンセルボタンで cancel を emit', async () => {
    const emitted = await mountDialog()
    buttonByText('キャンセル')?.click()
    await vi.waitFor(() => expect(emitted.cancel).toBe(1))
  })
})

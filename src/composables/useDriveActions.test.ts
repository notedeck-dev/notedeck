import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'

const promptMock = vi.fn<(opts: unknown) => Promise<string | null>>()
const confirmMock = vi.fn<(opts: unknown) => Promise<boolean>>()
const toastShowMock = vi.fn()

vi.mock('@/stores/prompt', () => ({
  usePrompt: () => ({ prompt: promptMock }),
}))
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}))
vi.mock('@/stores/toast', () => ({
  useToast: () => ({ show: toastShowMock }),
}))

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiCreateDriveFolder: vi.fn(),
      apiUpdateDriveFolder: vi.fn(),
      apiDeleteDriveFolder: vi.fn(),
      apiUpdateDriveFile: vi.fn(),
      apiMoveDriveFiles: vi.fn(),
      apiDeleteDriveFile: vi.fn(),
    },
  }
})

import type { NormalizedDriveFile } from '@/adapters/types'
import { useUiStore } from '@/stores/ui'
import { commands } from '@/utils/tauriInvoke'
import { useDriveActions } from './useDriveActions'

const mocked = commands as unknown as {
  apiCreateDriveFolder: ReturnType<typeof vi.fn>
  apiUpdateDriveFolder: ReturnType<typeof vi.fn>
  apiDeleteDriveFolder: ReturnType<typeof vi.fn>
  apiUpdateDriveFile: ReturnType<typeof vi.fn>
  apiMoveDriveFiles: ReturnType<typeof vi.fn>
  apiDeleteDriveFile: ReturnType<typeof vi.fn>
}

function makeFile(id: string): NormalizedDriveFile {
  return {
    id,
    name: `${id}.png`,
    type: 'image/png',
    url: `https://example.test/${id}`,
    thumbnailUrl: null,
    size: 1,
    isSensitive: false,
    comment: null,
    width: null,
    height: null,
    blurhash: null,
  }
}

const ok = (data: unknown = null) => ({ status: 'ok', data })
const apiError = (code: string) => ({
  status: 'error',
  error: { code: 'API', message: `endpoint: ${code}: detail` },
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('useDriveActions (#792)', () => {
  it('createFolder: prompt キャンセル / 空白のみでは API を呼ばない', async () => {
    const actions = useDriveActions()
    promptMock.mockResolvedValueOnce(null)
    expect(await actions.createFolder('acc1', null)).toBeNull()
    promptMock.mockResolvedValueOnce('   ')
    expect(await actions.createFolder('acc1', null)).toBeNull()
    expect(mocked.apiCreateDriveFolder).not.toHaveBeenCalled()
  })

  it('createFolder: 成功時に作成フォルダを返し bump する', async () => {
    const actions = useDriveActions()
    const uiStore = useUiStore()
    promptMock.mockResolvedValueOnce('新フォルダ')
    mocked.apiCreateDriveFolder.mockResolvedValueOnce(
      ok({ id: 'fo1', name: '新フォルダ', parentId: 'parent1' }),
    )
    const created = await actions.createFolder('acc1', 'parent1')
    expect(mocked.apiCreateDriveFolder).toHaveBeenCalledWith(
      'acc1',
      '新フォルダ',
      'parent1',
    )
    expect(created).toEqual({
      id: 'fo1',
      name: '新フォルダ',
      parentId: 'parent1',
    })
    expect(uiStore.driveFilesChanged.accountId).toBe('acc1')
  })

  it('createFolder: RATE_LIMIT_EXCEEDED は意訳して toast 表示し null を返す', async () => {
    const actions = useDriveActions()
    promptMock.mockResolvedValueOnce('x')
    mocked.apiCreateDriveFolder.mockResolvedValueOnce(
      apiError('RATE_LIMIT_EXCEEDED'),
    )
    expect(await actions.createFolder('acc1', null)).toBeNull()
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('回数制限'),
      'error',
    )
  })

  it('renameFolder: 現名と同じ・キャンセルでは API を呼ばない', async () => {
    const actions = useDriveActions()
    const folder = { id: 'fo1', name: '既存', parentId: null }
    promptMock.mockResolvedValueOnce('既存')
    await actions.renameFolder('acc1', folder)
    promptMock.mockResolvedValueOnce(null)
    await actions.renameFolder('acc1', folder)
    expect(mocked.apiUpdateDriveFolder).not.toHaveBeenCalled()
  })

  it('deleteFolder: confirm 否認では API を呼ばない、承認で呼んで bump する', async () => {
    const actions = useDriveActions()
    const uiStore = useUiStore()
    const folder = { id: 'fo1', name: 'ゴミ', parentId: null }
    confirmMock.mockResolvedValueOnce(false)
    await actions.deleteFolder('acc1', folder)
    expect(mocked.apiDeleteDriveFolder).not.toHaveBeenCalled()
    confirmMock.mockResolvedValueOnce(true)
    mocked.apiDeleteDriveFolder.mockResolvedValueOnce(ok())
    await actions.deleteFolder('acc1', folder)
    expect(mocked.apiDeleteDriveFolder).toHaveBeenCalledWith('acc1', 'fo1')
    expect(uiStore.driveFilesChanged.accountId).toBe('acc1')
  })

  it('deleteFolder: HAS_CHILD_FILES_OR_FOLDERS を意訳表示する', async () => {
    const actions = useDriveActions()
    confirmMock.mockResolvedValueOnce(true)
    mocked.apiDeleteDriveFolder.mockResolvedValueOnce(
      apiError('HAS_CHILD_FILES_OR_FOLDERS'),
    )
    await actions.deleteFolder('acc1', { id: 'fo1', name: 'x', parentId: null })
    expect(toastShowMock).toHaveBeenCalledWith(
      'フォルダが空ではないため削除できません',
      'error',
    )
  })

  it('accountId falsy では何もしない (early return)', async () => {
    const actions = useDriveActions()
    expect(await actions.createFolder(null, null)).toBeNull()
    await actions.renameFile(undefined, makeFile('f1'))
    expect(await actions.moveFiles(null, ['f1'], null)).toBe(false)
    expect(await actions.deleteFile(null, makeFile('f1'))).toBe(false)
    expect(promptMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('moveFiles: 100 件ずつチャンクして呼ぶ', async () => {
    const actions = useDriveActions()
    const ids = Array.from({ length: 250 }, (_, i) => `f${i}`)
    mocked.apiMoveDriveFiles.mockResolvedValue(ok())
    expect(await actions.moveFiles('acc1', ids, 'dest')).toBe(true)
    expect(mocked.apiMoveDriveFiles).toHaveBeenCalledTimes(3)
    expect(mocked.apiMoveDriveFiles.mock.calls[0]?.[1]).toHaveLength(100)
    expect(mocked.apiMoveDriveFiles.mock.calls[1]?.[1]).toHaveLength(100)
    expect(mocked.apiMoveDriveFiles.mock.calls[2]?.[1]).toHaveLength(50)
    expect(mocked.apiMoveDriveFiles.mock.calls[0]?.[2]).toBe('dest')
  })

  it('moveFiles: 途中チャンク失敗で中断し、それでも bump する', async () => {
    const actions = useDriveActions()
    const uiStore = useUiStore()
    const ids = Array.from({ length: 250 }, (_, i) => `f${i}`)
    mocked.apiMoveDriveFiles
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(apiError('INTERNAL_ERROR'))
    expect(await actions.moveFiles('acc1', ids, null)).toBe(false)
    expect(mocked.apiMoveDriveFiles).toHaveBeenCalledTimes(2)
    expect(toastShowMock).toHaveBeenCalled()
    expect(uiStore.driveFilesChanged.accountId).toBe('acc1')
  })

  it('deleteFile: 成功で true、失敗で toast + false', async () => {
    const actions = useDriveActions()
    confirmMock.mockResolvedValue(true)
    mocked.apiDeleteDriveFile.mockResolvedValueOnce(ok())
    expect(await actions.deleteFile('acc1', makeFile('f1'))).toBe(true)
    mocked.apiDeleteDriveFile.mockResolvedValueOnce(apiError('NO_SUCH_FILE'))
    expect(await actions.deleteFile('acc1', makeFile('f2'))).toBe(false)
    expect(toastShowMock).toHaveBeenCalled()
  })
})

describe('driveFilesChanged 更新伝播（watch 正規形の回帰）', () => {
  it('uiStore 経由の watch は emitDriveFilesChanged で発火する', async () => {
    const uiStore = useUiStore()
    const fired: string[] = []
    watch(
      () => uiStore.driveFilesChanged,
      (sig) => fired.push(sig.accountId),
    )
    uiStore.emitDriveFilesChanged('acc1')
    await nextTick()
    expect(fired).toEqual(['acc1'])
  })

  it('分割代入した値の watch は発火しない（footgun の記録）', async () => {
    const uiStore = useUiStore()
    const { driveFilesChanged } = uiStore
    const fired: string[] = []
    watch(
      () => driveFilesChanged,
      (sig) => fired.push(sig.accountId),
    )
    uiStore.emitDriveFilesChanged('acc1')
    await nextTick()
    expect(fired).toEqual([])
  })
})

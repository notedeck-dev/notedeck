import { describe, expect, it, vi } from 'vitest'
import type { DriveFolder, NormalizedDriveFile } from '@/adapters/types'

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiGetDriveFolders: vi.fn(async () => ({ status: 'ok', data: [] })),
      apiGetDriveFiles: vi.fn(async () => ({ status: 'ok', data: [] })),
    },
  }
})

import { useDriveFolder } from './useDriveFolder'

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

function setup(initialStack?: DriveFolder[]) {
  return useDriveFolder({ accountId: () => 'acc1', initialStack })
}

describe('useDriveFolder 選択セマンティクス (#792)', () => {
  it('selectAll は他階層の選択を保持したまま現フォルダ分を加算する (union)', () => {
    const drive = setup()
    drive.toggleFile('other1') // 他階層で選択済みの想定
    drive.files.value = [makeFile('f1'), makeFile('f2')]
    drive.selectAll()
    expect(drive.selectedIds.value).toEqual(new Set(['other1', 'f1', 'f2']))
  })

  it('deselectCurrent は現フォルダ分のみ解除し他階層の選択を保持する', () => {
    const drive = setup()
    drive.toggleFile('other1')
    drive.files.value = [makeFile('f1'), makeFile('f2')]
    drive.selectAll()
    drive.deselectCurrent()
    expect(drive.selectedIds.value).toEqual(new Set(['other1']))
  })

  it('deselectAll は全クリアする', () => {
    const drive = setup()
    drive.toggleFile('other1')
    drive.files.value = [makeFile('f1')]
    drive.selectAll()
    drive.deselectAll()
    expect(drive.selectedIds.value.size).toBe(0)
  })

  it('selectedOutsideCount は現フォルダの files に無い選択数を返す', () => {
    const drive = setup()
    drive.toggleFile('other1')
    drive.toggleFile('other2')
    drive.files.value = [makeFile('f1'), makeFile('f2')]
    drive.toggleFile('f1')
    expect(drive.selectedOutsideCount.value).toBe(2)
    expect(drive.selectedCount.value).toBe(3)
  })

  it('initialStack で folderStack が初期化される', () => {
    const stack: DriveFolder[] = [
      { id: 'p1', name: '親', parentId: null },
      { id: 'c1', name: '子', parentId: 'p1' },
    ]
    const drive = setup(stack)
    expect(drive.folderStack.value).toEqual(stack)
    // コピーであること（呼び出し元の配列を汚さない）
    drive.folderStack.value.pop()
    expect(stack.length).toBe(2)
  })
})

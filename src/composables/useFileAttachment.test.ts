import { describe, expect, it, vi } from 'vitest'
import type { NormalizedDriveFile, ServerAdapter } from '@/adapters/types'
import { useFileAttachment } from '@/composables/useFileAttachment'

function makeDriveFile(id: string): NormalizedDriveFile {
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

function setup(mocks: { uploadFile?: unknown; uploadFileFromPath?: unknown }) {
  const adapter = {
    api: {
      uploadFile: mocks.uploadFile ?? vi.fn(),
      uploadFileFromPath: mocks.uploadFileFromPath ?? vi.fn(),
    },
  } as unknown as ServerAdapter
  const error = { value: null as string | null }
  return { attachment: useFileAttachment(() => adapter, error), error }
}

function makeFile(name: string, bytes: number[] = [1]): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

describe('uploadBrowserFiles (クリップボードペースト #753)', () => {
  it('File のバイト列を adapter.api.uploadFile へ渡して添付する', async () => {
    const uploadFile = vi.fn().mockResolvedValue(makeDriveFile('f1'))
    const { attachment } = setup({ uploadFile })

    await attachment.uploadBrowserFiles([makeFile('image.png', [1, 2, 3])])

    expect(uploadFile).toHaveBeenCalledWith('image.png', [1, 2, 3], 'image/png')
    expect(attachment.attachedFiles.value.map((f) => f.id)).toEqual(['f1'])
    expect(attachment.isUploading.value).toBe(false)
    expect(attachment.pendingUploads.value).toEqual([])
  })
})

describe('ファイル別アップロード進捗 (#753)', () => {
  it('一部が失敗しても成功分は添付され、失敗分は error として残る', async () => {
    const uploadFileFromPath = vi
      .fn()
      .mockImplementation(async (path: string) => {
        if (path.endsWith('bad.png')) throw new Error('boom')
        return makeDriveFile('ok1')
      })
    const { attachment } = setup({ uploadFileFromPath })

    await attachment.uploadFilesFromPaths(['/tmp/ok.png', '/tmp/bad.png'])

    expect(attachment.attachedFiles.value.map((f) => f.id)).toEqual(['ok1'])
    expect(attachment.pendingUploads.value).toHaveLength(1)
    expect(attachment.pendingUploads.value[0]?.status).toBe('error')
    expect(attachment.pendingUploads.value[0]?.name).toBe('bad.png')
    expect(attachment.isUploading.value).toBe(false)
  })

  it('retryUpload で失敗分を再試行して添付できる', async () => {
    const uploadFileFromPath = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeDriveFile('f2'))
    const { attachment } = setup({ uploadFileFromPath })

    await attachment.uploadFilesFromPaths(['/tmp/a.png'])
    const key = attachment.pendingUploads.value[0]?.key as string
    await attachment.retryUpload(key)

    expect(attachment.attachedFiles.value.map((f) => f.id)).toEqual(['f2'])
    expect(attachment.pendingUploads.value).toEqual([])
  })

  it('dismissUpload で失敗エントリを破棄できる', async () => {
    const uploadFileFromPath = vi.fn().mockRejectedValue(new Error('boom'))
    const { attachment } = setup({ uploadFileFromPath })

    await attachment.uploadFilesFromPaths(['/tmp/a.png'])
    const key = attachment.pendingUploads.value[0]?.key as string
    attachment.dismissUpload(key)

    expect(attachment.pendingUploads.value).toEqual([])
  })
})

describe('並べ替えとメタ更新 (#753)', () => {
  it('reorderFiles でドラッグ位置へ移動できる (範囲外は no-op)', () => {
    const { attachment } = setup({})
    attachment.attachedFiles.value = [
      makeDriveFile('a'),
      makeDriveFile('b'),
      makeDriveFile('c'),
    ]

    attachment.reorderFiles(0, 2)
    expect(attachment.attachedFiles.value.map((f) => f.id)).toEqual([
      'b',
      'c',
      'a',
    ])
    attachment.reorderFiles(2, 0)
    expect(attachment.attachedFiles.value.map((f) => f.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    attachment.reorderFiles(0, 5)
    expect(attachment.attachedFiles.value.map((f) => f.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('applyFileMeta で alt / センシティブ / ファイル名をローカル更新できる', () => {
    const { attachment } = setup({})
    attachment.attachedFiles.value = [makeDriveFile('a')]

    attachment.applyFileMeta('a', {
      comment: '説明',
      isSensitive: true,
      name: 'renamed.png',
    })

    expect(attachment.attachedFiles.value[0]?.comment).toBe('説明')
    expect(attachment.attachedFiles.value[0]?.isSensitive).toBe(true)
    expect(attachment.attachedFiles.value[0]?.name).toBe('renamed.png')
  })
})

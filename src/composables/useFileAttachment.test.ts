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

function setup(uploadFileMock = vi.fn()) {
  const adapter = {
    api: { uploadFile: uploadFileMock },
  } as unknown as ServerAdapter
  const error = { value: null as string | null }
  const attachment = useFileAttachment(() => adapter, error)
  return { attachment, error, uploadFileMock }
}

describe('uploadBrowserFiles (クリップボードペースト #753)', () => {
  it('File のバイト列を adapter.api.uploadFile へ渡して添付する', async () => {
    const uploadFileMock = vi.fn().mockResolvedValue(makeDriveFile('f1'))
    const { attachment } = setup(uploadFileMock)

    const file = new File([new Uint8Array([1, 2, 3])], 'image.png', {
      type: 'image/png',
    })
    await attachment.uploadBrowserFiles([file])

    expect(uploadFileMock).toHaveBeenCalledWith(
      'image.png',
      [1, 2, 3],
      'image/png',
    )
    expect(attachment.attachedFiles.value.map((f) => f.id)).toEqual(['f1'])
    expect(attachment.isUploading.value).toBe(false)
  })

  it('MIME タイプが空なら application/octet-stream で送る', async () => {
    const uploadFileMock = vi.fn().mockResolvedValue(makeDriveFile('f1'))
    const { attachment } = setup(uploadFileMock)

    const file = new File([new Uint8Array([1])], 'data.bin', { type: '' })
    await attachment.uploadBrowserFiles([file])

    expect(uploadFileMock).toHaveBeenCalledWith(
      'data.bin',
      [1],
      'application/octet-stream',
    )
  })

  it('アップロード失敗時は error をセットし isUploading を戻す', async () => {
    const uploadFileMock = vi.fn().mockRejectedValue(new Error('boom'))
    const { attachment, error } = setup(uploadFileMock)

    const file = new File([new Uint8Array([1])], 'a.png', {
      type: 'image/png',
    })
    await attachment.uploadBrowserFiles([file])

    expect(error.value).toContain('boom')
    expect(attachment.attachedFiles.value).toEqual([])
    expect(attachment.isUploading.value).toBe(false)
  })
})

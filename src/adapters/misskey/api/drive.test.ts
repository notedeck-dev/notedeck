import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/tauriInvoke', () => ({
  commands: {},
  unwrap: (x: unknown) => x,
}))

import { normalizeDriveFile } from './drive'

describe('normalizeDriveFile（useDriveFilesByIds からの移設回帰）', () => {
  it('生レスポンスの各フィールドを NormalizedDriveFile にマッピングする', () => {
    const normalized = normalizeDriveFile({
      id: 'f1',
      name: 'photo.png',
      type: 'image/png',
      url: 'https://example.test/photo.png',
      thumbnailUrl: 'https://example.test/thumb.png',
      size: 1234,
      isSensitive: true,
      comment: 'alt text',
      properties: { width: 800, height: 600 },
      blurhash: 'LEHV6nWB2yk8',
    })
    expect(normalized).toEqual({
      id: 'f1',
      name: 'photo.png',
      type: 'image/png',
      url: 'https://example.test/photo.png',
      thumbnailUrl: 'https://example.test/thumb.png',
      size: 1234,
      isSensitive: true,
      comment: 'alt text',
      width: 800,
      height: 600,
      blurhash: 'LEHV6nWB2yk8',
    })
  })

  it('省略可能フィールドは null に正規化される', () => {
    const normalized = normalizeDriveFile({
      id: 'f2',
      name: 'doc.pdf',
      type: 'application/pdf',
      url: 'https://example.test/doc.pdf',
      thumbnailUrl: null,
      size: 10,
      isSensitive: false,
    })
    expect(normalized.thumbnailUrl).toBeNull()
    expect(normalized.comment).toBeNull()
    expect(normalized.width).toBeNull()
    expect(normalized.height).toBeNull()
    expect(normalized.blurhash).toBeNull()
  })
})

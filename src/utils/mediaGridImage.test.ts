import { describe, expect, it } from 'vitest'
import type { NormalizedDriveFile } from '@/adapters/types'
import { APP_HTTP_PORT } from '@/utils/appHttpPort'
import { mediaGridImage, previewableMediaCount } from '@/utils/mediaGridImage'

const BASE = `http://127.0.0.1:${APP_HTTP_PORT}/proxy/image`

function file(over: Partial<NormalizedDriveFile> = {}): NormalizedDriveFile {
  return {
    id: 'f',
    type: 'image/png',
    url: 'https://media.example/orig.png',
    thumbnailUrl: 'https://media.example/thumb.webp',
    isSensitive: false,
    ...over,
  } as NormalizedDriveFile
}

function q(url: string, w: number): string {
  return `${BASE}?url=${encodeURIComponent(url)}&w=${w}`
}

describe('mediaGridImage', () => {
  it('単一メディアは 640 / 1280 の 1x/2x で取得する', () => {
    const img = mediaGridImage(file(), 1)
    const thumb = 'https://media.example/thumb.webp'
    expect(img?.src).toBe(q(thumb, 640))
    expect(img?.srcset).toBe(`${q(thumb, 640)} 1x, ${q(thumb, 1280)} 2x`)
  })

  it('複数メディアのセルは 320 / 640', () => {
    const img = mediaGridImage(file(), 3)
    const thumb = 'https://media.example/thumb.webp'
    expect(img?.src).toBe(q(thumb, 320))
    expect(img?.srcset).toBe(`${q(thumb, 320)} 1x, ${q(thumb, 640)} 2x`)
  })

  it('サムネイルが無ければ原寸 URL をリサイズして使う', () => {
    const img = mediaGridImage(file({ thumbnailUrl: null }), 1)
    expect(img?.src).toBe(q('https://media.example/orig.png', 640))
  })

  it('安全でない URL は出さない', () => {
    expect(
      mediaGridImage(file({ thumbnailUrl: null, url: 'javascript:x' }), 1),
    ).toBeUndefined()
  })

  it('プロキシに載らない URL は srcset を付けず素通し', () => {
    const img = mediaGridImage(
      file({ thumbnailUrl: 'http://media.example/a.png' }),
      1,
    )
    expect(img).toEqual({ src: 'http://media.example/a.png' })
  })
})

describe('previewableMediaCount', () => {
  it('画像と動画だけを数える', () => {
    expect(
      previewableMediaCount([
        file({ type: 'image/png' }),
        file({ type: 'video/mp4' }),
        file({ type: 'audio/mpeg' }),
        file({ type: 'application/zip' }),
      ]),
    ).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'
import { estimateImageMemory, isLocalAssetUrl } from './imageMemory'

const img = (currentSrc: string, w: number, h: number) => ({
  currentSrc,
  naturalWidth: w,
  naturalHeight: h,
})

const noLocal = () => false

describe('estimateImageMemory (#732 / #991)', () => {
  it('同一 URL の img 要素は 1 回だけ数える (要素ごとの合計は重複計上になる)', () => {
    const result = estimateImageMemory(
      [
        img('https://cdn.example/a.webp', 100, 100),
        img('https://cdn.example/a.webp', 100, 100),
        img('https://cdn.example/a.webp', 100, 100),
        img('https://cdn.example/b.webp', 10, 10),
      ],
      noLocal,
    )
    expect(result).toEqual({
      elementCount: 4,
      uniqueCount: 2,
      estimatedDecodedBytes: 100 * 100 * 4 + 10 * 10 * 4,
    })
  })

  it('ローカル資産と未ロード (src なし) は集計から除外する', () => {
    const result = estimateImageMemory(
      [
        img('data:image/svg+xml;base64,xxx', 48, 48),
        img('tauri://localhost/assets/cat-ears.svg', 48, 48),
        img('', 0, 0),
        img('https://cdn.example/a.webp', 100, 100),
      ],
      (url) => url.startsWith('data:') || url.startsWith('tauri://localhost'),
    )
    expect(result).toEqual({
      elementCount: 1,
      uniqueCount: 1,
      estimatedDecodedBytes: 100 * 100 * 4,
    })
  })

  it('画像なしは全ゼロ', () => {
    expect(estimateImageMemory([], noLocal)).toEqual({
      elementCount: 0,
      uniqueCount: 0,
      estimatedDecodedBytes: 0,
    })
  })
})

describe('isLocalAssetUrl', () => {
  const origin = 'https://app.example'

  it('data/blob とアプリ自身のオリジンだけをローカル扱いする', () => {
    expect(isLocalAssetUrl('data:image/png;base64,x', origin)).toBe(true)
    expect(isLocalAssetUrl('blob:https://app.example/uuid', origin)).toBe(true)
    expect(isLocalAssetUrl('https://app.example/assets/logo.svg', origin)).toBe(
      true,
    )
    expect(isLocalAssetUrl('https://cdn.example/a.webp', origin)).toBe(false)
  })

  it('接頭辞が一致するだけの別オリジンはリモート扱い (過少報告防止)', () => {
    expect(isLocalAssetUrl('https://app.example.evil/a.webp', origin)).toBe(
      false,
    )
  })

  it('parse 不能な URL は集計から外す (ローカル扱い)', () => {
    expect(isLocalAssetUrl('not a url', origin)).toBe(true)
  })
})

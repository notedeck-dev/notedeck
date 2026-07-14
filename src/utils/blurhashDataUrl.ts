import { decode } from 'blurhash'

const cache = new Map<string, string | null>()

/**
 * blurhash を data URL (32x32 PNG) にデコードする。
 * 画像ロード完了までのプレースホルダ用。結果はプロセス内でキャッシュする。
 */
export function blurhashToDataUrl(hash: string): string | null {
  const cached = cache.get(hash)
  if (cached !== undefined) return cached

  let result: string | null = null
  try {
    const size = 32
    const pixels = decode(hash, size, size)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const imageData = ctx.createImageData(size, size)
      imageData.data.set(pixels)
      ctx.putImageData(imageData, 0, 0)
      result = canvas.toDataURL()
    }
  } catch {
    result = null // 不正な blurhash 文字列は無視 (シマーにフォールバック)
  }
  cache.set(hash, result)
  return result
}

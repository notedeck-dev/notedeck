import { decode } from 'blurhash'
import { createBoundedCache } from '@/services/boundedCache'
import { usePerformanceStore } from '@/stores/performance'

// 長時間スクロールで見た blurhash がすべて残り続けていた (#987)。
// data URL は 1 件あたり数 KB あるので、素の Map では単調増加する
const cache = createBoundedCache<string, string | null>(() => {
  try {
    return usePerformanceStore().get('blurhashCacheMax')
  } catch {
    return 256
  }
}, 'blurhash-data-url')

/**
 * blurhash を data URL (32x32 PNG) にデコードする。
 * 画像ロード完了までのプレースホルダ用。結果はプロセス内でキャッシュする。
 */
export function blurhashToDataUrl(hash: string): string | null {
  if (cache.has(hash)) return cache.get(hash) ?? null

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

/**
 * デコード済み画像メモリの推定 (#732 / #991)。
 *
 * #991 の外形計測で踏んだ罠を最初から正しい側で実装する:
 * - **ユニーク URL 単位で集計する** — img 要素ごとに合計すると同一画像が
 *   重複計上され、実態 16.7MB が 98.4MB に見える
 * - **ローカル資産 (data: / アプリ自身のオリジン) は除外する** — 同梱 SVG を
 *   リモート画像として誤計上した実例がある
 *
 * 推定は naturalWidth × naturalHeight × 4 (RGBA)。GPU 側の実際の保持形式
 * には依存しないラフな見積もりで、絶対値よりスナップショット間の比較に使う。
 */

export interface ImageLike {
  currentSrc: string
  naturalWidth: number
  naturalHeight: number
}

export interface ImageMemoryEstimate {
  /** 集計対象 (リモート画像) の img 要素数。重複込み */
  elementCount: number
  /** ユニーク URL 数 */
  uniqueCount: number
  /** デコード済みメモリの推定 (ユニーク URL 単位、W×H×4 bytes) */
  estimatedDecodedBytes: number
}

/**
 * アプリ自身の資産 (同梱 SVG / 生成 blob) をリモート画像として誤計上しない
 * ための判定。同一オリジンは URL の origin 同士で比較する — 接頭辞比較だと
 * `https://app.example.evil/...` もローカル扱いになり過少報告する。
 */
export function isLocalAssetUrl(url: string, appOrigin: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true
  try {
    return new URL(url).origin === appOrigin
  } catch {
    // parse 不能な URL はサイズ推定も信用できないので集計から外す
    return true
  }
}

export function estimateImageMemory(
  images: Iterable<ImageLike>,
  isLocalAsset: (url: string) => boolean,
): ImageMemoryEstimate {
  const bytesByUrl = new Map<string, number>()
  let elementCount = 0
  for (const img of images) {
    const url = img.currentSrc
    if (!url || isLocalAsset(url)) continue
    elementCount++
    if (!bytesByUrl.has(url)) {
      bytesByUrl.set(url, img.naturalWidth * img.naturalHeight * 4)
    }
  }
  let estimatedDecodedBytes = 0
  for (const bytes of bytesByUrl.values()) estimatedDecodedBytes += bytes
  return { elementCount, uniqueCount: bytesByUrl.size, estimatedDecodedBytes }
}

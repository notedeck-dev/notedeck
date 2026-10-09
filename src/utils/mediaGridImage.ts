import type { NormalizedDriveFile } from '@/adapters/types'
import { isSafeUrl } from '@/services/safeUrl'
import { proxyThumbUrl } from '@/utils/mediaProxy'

/**
 * ノートの添付画像グリッド (MkMediaGrid) の表示用 URL (#704 O-2)。
 *
 * 表示幅に見合うサイズでプロキシに縮小させる。サムネイルの無いリモート
 * ファイルは原寸 URL しか無く、数千 px の写真をカラム幅 (最大 600px 前後)
 * のセルに描くためにそのまま取得・デコードしていた。Misskey のサムネイルは
 * 元から 500px 程度なので、指定幅以下ならプロキシが素通しして再エンコード
 * しない。
 *
 * 幅は実測せず 2 段に丸める。セルごとの実測幅を渡すと variant が幅の数だけ
 * 増えてディスクキャッシュが割れ、先読み (useImagePrefetch) と URL を
 * 一致させられなくなるため。単一メディアはノート本文の幅、複数はその半分を
 * 1x とし、2x はブラウザが DPR で選ぶ (MkAvatar と同じ方式)。
 * 単一の 1x と複数の 2x は同じ幅なので variant を共有する。
 */
const SINGLE_WIDTH = 640
const MULTI_WIDTH = 320

export function previewableMediaCount(files: NormalizedDriveFile[]): number {
  return files.filter(
    (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
  ).length
}

export function mediaGridImage(
  file: NormalizedDriveFile,
  previewableCount: number,
): { src: string; srcset?: string } | undefined {
  const raw = [file.thumbnailUrl, file.url].find(
    (u): u is string => !!u && isSafeUrl(u),
  )
  if (!raw) return undefined
  const width = previewableCount > 1 ? MULTI_WIDTH : SINGLE_WIDTH
  const x1 = proxyThumbUrl(raw, width) ?? raw
  const x2 = proxyThumbUrl(raw, width * 2) ?? raw
  if (x1 === raw) return { src: raw }
  return { src: x1, srcset: `${x1} 1x, ${x2} 2x` }
}

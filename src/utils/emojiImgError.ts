import { ensurePlaceholderRecovery, markMediaFailed } from '@/utils/mediaProxy'

/**
 * カスタム絵文字 `<img>` の onerror 共通ハンドラ (#844)。
 *
 * unknown アイコンに落としつつ、プロキシへ失敗を申告してバックオフ再試行
 * させる。再試行で世代付き URL に変わると :src バインドが再評価され、
 * unknown アイコンから自然に復帰する。src の DOM 書き換えだけだと一過性の
 * 失敗 (リモート鯖の瞬断・プロキシ 502/504) がセッション中固定化する。
 */
export function onCustomEmojiImgError(e: Event): void {
  const img = e.target as HTMLImageElement
  if (img.src.endsWith('/emoji-unknown.svg')) return
  const raw = proxiedRawUrl(img.src)
  if (raw) markMediaFailed(raw)
  img.src = '/emoji-unknown.svg'
}

/**
 * カスタム絵文字 `<img>` の @load 共通ハンドラ。
 *
 * 二段階配信の透明プレースホルダ (1×1) を掴んだままの滞留を申告する。
 * MediaFetched イベントを取りこぼすと onerror も発火しないまま透明が
 * 固定化するため、@load 側から自己修復に乗せる (mediaProxy の
 * ensurePlaceholderRecovery 参照)。実画像 (1×1 でない) は何もしない。
 */
export function onCustomEmojiImgLoad(e: Event): void {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth !== 1 || img.naturalHeight !== 1) return
  const raw = proxiedRawUrl(img.src)
  if (raw) ensurePlaceholderRecovery(raw)
}

/** プロキシ URL (`...?url=<encoded>`) から元 URL を取り出す */
function proxiedRawUrl(src: string): string | null {
  try {
    return new URL(src).searchParams.get('url')
  } catch {
    return null
  }
}

/**
 * カスタム絵文字 `<img>` の onerror 共通ハンドラ (#844)。
 *
 * unknown アイコンへの DOM フォールバックだけを行う。失敗の申告
 * (バックオフ再試行) は mediaProxy の installMediaWatchdog が document
 * capture で全 `<img>` の error を一括して拾う — 再試行で世代付き URL に
 * 変わると :src バインドが再評価され、unknown アイコンから自然に復帰する。
 */
export function onCustomEmojiImgError(e: Event): void {
  const img = e.target as HTMLImageElement
  if (img.src.endsWith('/emoji-unknown.svg')) return
  img.src = '/emoji-unknown.svg'
}

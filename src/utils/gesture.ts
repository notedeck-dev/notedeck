/**
 * touch が要素内に DOM ネストされたトップレイヤー要素 (dialog / popover) 由来か。
 * showModal() / showPopover() は要素の DOM 位置を変えないため、ノート内に置かれた
 * 絵文字ピッカーなどのオーバーレイ内のドラッグがカラムまで bubble し、
 * その裏の pull-to-refresh (#810) やタブ切替 (#811) を発火させてしまう。
 * 要素自身を包む dialog（ウィンドウ表示のカラム）は対象外。
 */
export function isFromNestedOverlay(
  target: EventTarget | null,
  boundary: HTMLElement,
): boolean {
  if (!(target instanceof Element)) return false
  const overlay = target.closest('dialog, [popover]')
  return overlay !== null && boundary.contains(overlay)
}

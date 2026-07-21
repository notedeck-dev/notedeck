/**
 * textarea 内の指定位置の caret 座標を mirror div 方式で計算する (#753)。
 * textarea のレイアウトに影響する computed style を隠し div に複製し、
 * 対象位置に置いた marker span の offset を測る定番アルゴリズム。
 * 返る座標は textarea のコンテンツ座標系 (スクロール補正は呼び出し側)。
 */

// レイアウトを決定するプロパティのみ複製する (全 copy は不要かつ遅い)
const MIRROR_PROPERTIES = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'textIndent',
  'whiteSpace',
  'wordBreak',
  'overflowWrap',
  'tabSize',
] as const

export interface CaretCoordinates {
  left: number
  top: number
  /** caret 行の高さ (ポップアップを行の下に置くためのオフセット) */
  height: number
}

export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretCoordinates {
  const mirror = document.createElement('div')
  const style = window.getComputedStyle(textarea)

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  // textarea は常に折り返すので pre-wrap 相当を強制
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  for (const prop of MIRROR_PROPERTIES) {
    mirror.style[prop] = style[prop]
  }
  // width は content 幅を明示 (textarea のスクロールバー分を除く)
  mirror.style.width = `${textarea.clientWidth}px`

  mirror.textContent = textarea.value.slice(0, position)
  const marker = document.createElement('span')
  // 空 span は幅 0 で offset が取れないことがあるため後続 1 文字を入れる
  marker.textContent = textarea.value.slice(position, position + 1) || '.'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const lineHeight =
    Number.parseFloat(style.lineHeight) ||
    Number.parseFloat(style.fontSize) * 1.4
  const coords = {
    left: marker.offsetLeft,
    top: marker.offsetTop,
    height: lineHeight,
  }
  mirror.remove()
  return coords
}

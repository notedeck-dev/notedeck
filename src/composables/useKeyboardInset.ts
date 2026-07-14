/**
 * ソフトキーボードの高さを CSS 変数 `--nd-keyboard-inset` に反映する (#704 F)。
 * visualViewport の縮小分をキーボード高さとみなし、投稿フォーム下部や
 * 絵文字ピッカーなど bottom 固定 UI がキーボードに覆われないようにする。
 * キーボードが閉じている間は 0px。
 */
export function initKeyboardInset(): void {
  const vv = window.visualViewport
  if (!vv) return

  let raf = 0
  const update = () => {
    raf = 0
    const inset = Math.max(
      0,
      Math.round(window.innerHeight - vv.height - vv.offsetTop),
    )
    document.documentElement.style.setProperty(
      '--nd-keyboard-inset',
      `${inset}px`,
    )
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update)
  }

  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  update()
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown
}

// WebKitGTK (Linux デスクトップ) は startViewTransition が存在しても
// WebProcess ごとクラッシュすることがある (WSL2 で起動直後の設定ロード →
// テーマ再適用時に再現 #704)。feature detection では防げないため無効化する
const IS_LINUX_WEBKIT =
  /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)

/**
 * View Transitions API による画面全体のクロスフェード。
 * 未対応環境・reduced-motion・Linux WebKitGTK では即時実行にフォールバック
 * する (テーマ切替・プロファイル切替のフラッシュ抑制用のエンハンス枠)。
 * 戻り値は update コールバック完了を表す Promise (後続処理が適用後の
 * 状態に依存する場合は await すること)。
 */
export function withViewTransition(
  fn: () => void | Promise<void>,
): Promise<void> {
  const doc = document as DocumentWithViewTransition
  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  if (
    IS_LINUX_WEBKIT ||
    reduceMotion ||
    typeof doc.startViewTransition !== 'function'
  ) {
    return Promise.resolve(fn())
  }
  const vt = doc.startViewTransition(fn) as {
    updateCallbackDone?: Promise<void>
  }
  return vt.updateCallbackDone ?? Promise.resolve()
}

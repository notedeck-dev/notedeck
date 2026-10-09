/**
 * WebView 標準の右クリックメニューを出してよい場面か (#704)。
 *
 * 余白で「再読み込み」「戻る」等が出るとアプリの皮が剥がれるので既定では抑止し、
 * 標準メニューに正当な用途 (切り取り / 貼り付け / コピー / リンクや画像の操作)
 * がある場面だけ通す。独自メニューを出す面は自分で preventDefault するので
 * ここでは扱わない。開発者モードでは「要素の検証」のため常に通す。
 */
const NATIVE_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  'a[href]',
  'img',
  'video',
  'audio',
].join(',')

export function allowsNativeContextMenu(
  target: EventTarget | null,
  ctx: { hasSelection: boolean; developerMode: boolean },
): boolean {
  if (ctx.developerMode || ctx.hasSelection) return true
  if (!(target instanceof Element)) return false
  return target.closest(NATIVE_TARGET_SELECTOR) !== null
}

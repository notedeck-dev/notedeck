/**
 * IME 変換中の keydown かどうか。
 * Safari/WebKit 系は変換確定の Enter で isComposing が false のまま
 * keyCode 229 を報告するため両方を見る。
 */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}

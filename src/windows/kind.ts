/**
 * この窓が描いている画面の種別 (#1131)。
 *
 * 窓の素性 (main / ミラー / ポップアウト / PiP) の正本は Rust の名簿で、JS に
 * label / pathname / query の比較を散らさない (lint で検査)。ここは「自分は PiP 画面を
 * 描いているか」という描画側の事実だけを、唯一の場所で答える。
 */
export function isPipWindow(): boolean {
  return typeof window !== 'undefined' && window.location.pathname === '/pip'
}

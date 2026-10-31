/**
 * 宛先付きイベント (#1131)。
 *
 * Rust は「1 窓だけが処理する」イベント (deep link / 通知クリック / トレイの切替 /
 * 外部からの問い合わせ) を、宛先の label を `to` に持たせて全窓へ流す。受けた窓は
 * 自分宛てでなければ捨てる。handler にフィルタを書かせず、ここで 1 回だけ判定する。
 *
 * `emit_to` + 窓スコープの購読は採らない: target `Any` の購読が 1 本でも残ると
 * そこへ届いてしまい、「宛先でない窓は捨てる」が崩れる。payload は全窓に届くので
 * これは配送の最適化ではなく、同じアプリの窓どうしの約束 (認可ではない)。
 */
import type { UnlistenFn } from '@tauri-apps/api/event'
import { currentWindowLabel } from '@/utils/settingsFs'

export interface AddressedEventSource<P extends { to: string }> {
  listen(handler: (event: { payload: P }) => void): Promise<UnlistenFn>
}

export function listenAddressed<P extends { to: string }>(
  event: AddressedEventSource<P>,
  handler: (payload: P) => void,
): Promise<UnlistenFn> {
  return event.listen((e) => {
    const me = currentWindowLabel()
    if (me === null || e.payload.to !== me) return
    handler(e.payload)
  })
}

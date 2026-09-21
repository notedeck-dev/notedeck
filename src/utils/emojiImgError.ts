/**
 * カスタム絵文字 `<img>` の onerror 共通ハンドラ (#844)。
 *
 * プロキシ (127.0.0.1:19820/proxy/image) は上流の一時失敗で 502 を返す
 * ことがある — negative cache (network 5s) / circuit breaker の half-open
 * 待ち / 起動直後でネットワークが未接続、など。error を受けた瞬間に
 * unknown アイコンへ置き換えると、Vue の :src バインドは値が変わらない
 * 限り DOM を触らないので、その絵文字は再描画まで二度と戻らない (実機で
 * 「初手で描画できずエラー画像が出る」症状)。
 *
 * そこで間を空けて世代付き URL (`&r=N`、プロキシは無視する) で数回
 * 再要求し、使い切ったら unknown に倒す。世代番号は img.src 自身に
 * 載せるので、Vue が :src を差し替えれば (辞書更新・static 切替) 自然に
 * 振り出しへ戻る。
 */

const RETRY_DELAYS_MS = [2000, 6000]
const GENERATION_RE = /&r=(\d+)$/

export function onCustomEmojiImgError(e: Event): void {
  const img = e.target as HTMLImageElement
  const src = img.src
  if (src.endsWith('/emoji-unknown.svg')) return
  const attempt = Number(src.match(GENERATION_RE)?.[1] ?? 0)
  const delay = RETRY_DELAYS_MS[attempt]
  if (delay === undefined) {
    img.src = '/emoji-unknown.svg'
    return
  }
  const base = src.replace(GENERATION_RE, '')
  setTimeout(() => {
    // アンマウント済み / Vue が別 URL に差し替えた後は触らない
    if (!img.isConnected || img.src !== src) return
    img.src = `${base}&r=${attempt + 1}`
  }, delay)
}

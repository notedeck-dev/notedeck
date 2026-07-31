import { markMediaFailed, proxiedRawUrl } from '@/utils/mediaProxy'

/**
 * カスタム絵文字 `<img>` の onerror 共通ハンドラ (#844)。
 *
 * unknown アイコンに落としつつ、プロキシへ失敗を申告してバックオフ再試行
 * させる。再試行で世代付き URL に変わると :src バインドが再評価され、
 * unknown アイコンから自然に復帰する。src の DOM 書き換えだけだと一過性の
 * 失敗 (リモート鯖の瞬断・プロキシ 502/504) がセッション中固定化する。
 */
export function onCustomEmojiImgError(e: Event): void {
  const img = e.target as HTMLImageElement
  if (img.src.endsWith('/emoji-unknown.svg')) return
  const raw = proxiedRawUrl(img.src)
  if (raw) markMediaFailed(raw)
  img.src = '/emoji-unknown.svg'
}

// プレースホルダ滞留 (透明 1×1 のまま MediaFetched を取りこぼす) の自己修復は
// mediaProxy の installPlaceholderWatchdog が document capture で全 <img> を
// 一括監視する — 個別の @load 配線は不要

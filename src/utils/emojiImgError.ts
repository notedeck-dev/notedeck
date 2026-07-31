import { markMediaFailed } from '@/utils/mediaProxy'

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

/** プロキシ URL (`...?url=<encoded>`) から元 URL を取り出す */
function proxiedRawUrl(src: string): string | null {
  try {
    return new URL(src).searchParams.get('url')
  } catch {
    return null
  }
}

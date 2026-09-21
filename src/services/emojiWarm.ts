import type { ServerEmoji } from '@/adapters/types'
import { isTauri } from '@/utils/settingsFs'
import { commands } from '@/utils/tauriInvoke'

/**
 * 絵文字辞書が届いたら、その絵文字画像をプロキシに先行取得させる。
 *
 * 流速の速い TL では新規ノートの絵文字が「初めて見る」ものばかりで、
 * 表示のたびに上流取得 + 変換を待つと絵文字だけ遅れて出る。辞書の全件を
 * Rust 側の低優先キュー (`media_warm`) に渡し、キャッシュ済みは worker が
 * 飛ばすので 2 回目以降は差分だけが走る。表示側 (`proxyEmojiUrl`) と同じ
 * 高さ 128 の variant を温める。static (省電力) variant は温めない —
 * その状態では先読み自体を止める (#931)。抑制の判断 (省電力 / 従量制) は
 * 呼び出し側 (store) が systemState から引いて `suppress` で渡す
 */
export const EMOJI_VARIANT_HEIGHT = 128

export function warmEmojiImages(
  emojis: readonly ServerEmoji[],
  options: { suppress?: boolean } = {},
): void {
  if (!isTauri || options.suppress) return
  const urls: string[] = []
  for (const e of emojis) {
    if (e.url.startsWith('https://')) urls.push(e.url)
  }
  if (urls.length === 0) return
  commands.warmMedia(urls, EMOJI_VARIANT_HEIGHT).catch(() => {
    // 先読みは best-effort。失敗しても表示要求が同じ経路で取りにいく
  })
}

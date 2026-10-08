/**
 * 絵文字ミュート (#612) のキー正規化。本家 `utility/emoji-mute.ts` 互換:
 * - ローカルカスタム絵文字: `:name:`（`@.` は除去）
 * - リモートカスタム絵文字: `:name@host:`
 * - Unicode 絵文字: 生の文字そのまま
 *
 * 入力は `:name:` / `:name@.:` / `:name@host:` のキー形式、MFM トークンの
 * bare shortcode (`name` / `name@host`)、Unicode 文字のいずれでもよい。
 */

const BARE_SHORTCODE = /^[a-zA-Z0-9_]+(?:@[\w.-]+)?$/

export function normalizeEmojiMuteKey(emoji: string): string {
  let inner: string
  if (emoji.startsWith(':') && emoji.endsWith(':') && emoji.length > 2) {
    inner = emoji.slice(1, -1)
  } else if (BARE_SHORTCODE.test(emoji)) {
    inner = emoji
  } else {
    return emoji // Unicode 絵文字
  }
  const at = inner.indexOf('@')
  if (at === -1) return `:${inner}:`
  const name = inner.slice(0, at)
  const host = inner.slice(at + 1)
  return host === '' || host === '.' ? `:${name}:` : `:${name}@${host}:`
}

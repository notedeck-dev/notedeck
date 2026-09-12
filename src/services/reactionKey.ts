/**
 * サーバーを跨いだ「同じ絵文字」の照合キー (#1058 §5.3)。
 *
 * packed の reactions キーはサーバーの視点で書かれる: 自サーバーの絵文字は
 * `:name@.:` (myReaction は `:name:`)、他サーバーの絵文字は `:name@host:`。
 * 同じ絵文字でも見るサーバーで表記が変わるので、複数 variant の myReaction を
 * 突き合わせるにはこの正規形に写す。
 *
 * **比較にだけ使う**。ストア・楽観 patch・API 呼び出しは wire 形のまま
 * (notecli も他の消費者も wire 形を前提にしており、正規形で書くと同じ絵文字が
 * 2 キーで並ぶ)。API へ戻すときは `wireReaction` で逆写像する。
 */

export type CanonicalReactionKey = string & {
  readonly __brand: 'CanonicalReactionKey'
}

/** 本家 `decodeCustomEmojiRegexp` と同じ文法 */
const CUSTOM_EMOJI_RE = /^:([\w+-]+)(?:@([\w.-]+))?:$/

/**
 * Unicode 絵文字の正規化 (本家 ReactionService.normalize と同じ):
 * ZWJ シーケンスでなければ U+FE0F 異体字セレクタを剥がす。
 */
function normalizeUnicode(emoji: string): string {
  return emoji.includes('‍') ? emoji : emoji.replace(/️/g, '')
}

/**
 * @param reaction - wire 形のリアクション (`:name:` / `:name@.:` / `:name@host:` / Unicode)
 * @param host - その variant の取得元サーバー (`_serverHost`)
 */
export function canonicalReactionKey(
  reaction: string,
  host: string,
): CanonicalReactionKey {
  const m = reaction.match(CUSTOM_EMOJI_RE)
  if (!m) return normalizeUnicode(reaction) as CanonicalReactionKey
  const name = m[1]
  const emojiHost = m[2]
  const resolvedHost = !emojiHost || emojiHost === '.' ? host : emojiHost
  return `${name}@${resolvedHost.toLowerCase()}` as CanonicalReactionKey
}

/**
 * 正規形を、主ビューのサーバーへ送る wire 形に戻す。
 * 主ビューのサーバー自身の絵文字なら `:name:`、他サーバーの絵文字なら `:name@host:`。
 */
export function wireReaction(
  canonical: CanonicalReactionKey,
  primaryHost: string,
): string {
  const at = canonical.lastIndexOf('@')
  if (at <= 0) return canonical
  const name = canonical.slice(0, at)
  const host = canonical.slice(at + 1)
  if (!/^[\w+-]+$/.test(name)) return canonical
  return host === primaryHost.toLowerCase() ? `:${name}:` : `:${name}@${host}:`
}

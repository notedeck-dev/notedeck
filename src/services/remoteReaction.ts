/**
 * リモートユーザーが付けたリアクションに相乗りできるかの判定 (#630)。
 *
 * 本家 Misskey のリアクション作成はカスタム絵文字として `:name:` / `:name@.:`
 * の形しか受け付けず、`@ホスト名` 付きは Unicode 絵文字判定に落ちてフォール
 * バック (❤) になる。加えてローカルユーザーからのリアクションはローカル絵文字
 * セットしか検索しないため、**同一チップへの相乗りはサーバー側の仕様上でき
 * ない**。相乗りを成立させるにはサーバー実装 (連合キャッシュまで探索する
 * tempura 系) が必要で、クライアント側では対応サーバー以外で押させないことしか
 * できない。
 *
 * 本家 Web UI も同様にリモート絵文字リアクションをトグル対象外にしている。
 */

/** 本家 `decodeCustomEmojiRegexp` と同じ文法。名前とホストを取り出す */
const CUSTOM_EMOJI_RE = /^:([\w+-]+)(?:@([\w.-]+))?:$/

export type ReactionJoinability =
  /** 押せる */
  | 'ok'
  /** サーバーがリモート絵文字でのリアクションに対応していない */
  | 'unsupported-server'
  /** 対応サーバーだが、その絵文字を解決できない (サーバーが知らない可能性が高い) */
  | 'emoji-unavailable'

export function reactionJoinability(
  reaction: string,
  ctx: {
    /** リアクションを送るアカウントのサーバー */
    serverHost: string
    /** そのサーバーの `features.remoteEmojiReactions` */
    remoteEmojiReactions: boolean
    /** その絵文字の URL が解決できているか (ノートの reactionEmojis / 絵文字キャッシュ) */
    hasEmojiUrl: boolean
  },
): ReactionJoinability {
  const m = reaction.match(CUSTOM_EMOJI_RE)
  // Unicode 絵文字・カスタム絵文字として解釈できない文字列は判定対象外
  if (!m) return 'ok'

  const host = m[2]
  // `:foo:` / `:foo@.:` / 自サーバーのホスト付きはローカル絵文字
  if (!host || host === '.') return 'ok'
  if (host.toLowerCase() === ctx.serverHost.toLowerCase()) return 'ok'

  if (!ctx.remoteEmojiReactions) return 'unsupported-server'
  return ctx.hasEmojiUrl ? 'ok' : 'emoji-unavailable'
}

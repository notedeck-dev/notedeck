import { useEmojisStore } from '@/stores/emojis'

export function useEmojiResolver() {
  const emojisStore = useEmojisStore()

  /** Resolve emoji shortcode to URL using note-level data + server cache */
  function resolveEmoji(
    shortcode: string,
    emojis: Record<string, string>,
    reactionEmojis: Record<string, string>,
    serverHost: string,
  ): string | null {
    const base = shortcode.replace(/@\.$/, '')
    const withDot = `${base}@.`
    const url =
      emojis[shortcode] ||
      emojis[base] ||
      emojis[withDot] ||
      reactionEmojis[shortcode] ||
      reactionEmojis[base] ||
      reactionEmojis[withDot] ||
      emojisStore.resolve(serverHost, base)
    // どの層でも解決できない = 辞書が古い可能性 (起動後に追加された絵文字)。
    // store に報告してデバウンス付きの取り直しをトリガーする
    if (!url) emojisStore.reportMiss(serverHost, base)
    return url
  }

  /** Resolve reaction key (e.g. ":emoji:") to URL, or null for Unicode emoji */
  function reactionUrl(
    reaction: string,
    emojis: Record<string, string>,
    reactionEmojis: Record<string, string>,
    serverHost: string,
  ): string | null {
    if (reaction.startsWith(':') && reaction.endsWith(':')) {
      return resolveEmoji(
        reaction.slice(1, -1),
        emojis,
        reactionEmojis,
        serverHost,
      )
    }
    return null
  }

  return { resolveEmoji, reactionUrl }
}

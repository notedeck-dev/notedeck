/**
 * 同梱 Twemoji (@discordapp/twemoji、vite.config.ts の twemojiAssets が配る)。
 * CDN 個別取得はピッカー初回表示で数千リクエストをメディアプロキシに浴びせる
 * 要因だった (#855)。相対パスなので proxyUrl は素通しし、Tauri ではアプリ
 * アセットとして即応答される。
 */
const TWEMOJI_BASE = '/twemoji'

// ZWJ 連結は FE0F を残す規則だが、同梱 Twemoji は 👁️‍🗨️ だけ FE0F を落とした
// 名前で持つ。ピッカーの全絵文字との照合は twemoji.test.ts (#1219)
const FILE_NAME_EXCEPTIONS: Record<string, string> = {
  '1f441-fe0f-200d-1f5e8-fe0f': '1f441-200d-1f5e8',
}

/** Convert a Unicode emoji character to a bundled Twemoji SVG URL */
export function char2twemojiUrl(char: string): string {
  let codes = Array.from(char, (x) => x.codePointAt(0)?.toString(16))
  if (!codes.includes('200d')) codes = codes.filter((x) => x !== 'fe0f')
  codes = codes.filter((x) => x?.length)
  const name = codes.join('-')
  return `${TWEMOJI_BASE}/${FILE_NAME_EXCEPTIONS[name] ?? name}.svg`
}

/**
 * Regex to match Unicode emoji sequences.
 * Covers emoji presentation, variation selectors, ZWJ sequences, keycaps, and flags.
 */
const emojiRegex =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu

/** Split text into segments of plain text and Unicode emoji */
export function splitTextWithEmoji(
  text: string,
): { type: 'text' | 'emoji'; value: string; url?: string }[] {
  const segments: { type: 'text' | 'emoji'; value: string; url?: string }[] = []
  emojiRegex.lastIndex = 0
  let lastIndex = 0
  let m: RegExpExecArray | null = emojiRegex.exec(text)
  while (m !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, m.index) })
    }
    segments.push({ type: 'emoji', value: m[0], url: char2twemojiUrl(m[0]) })
    lastIndex = m.index + m[0].length
    m = emojiRegex.exec(text)
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}

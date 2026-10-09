import type { UnicodeEmojiDef } from '@/data/emojilist'

/** 絵文字 → キーワード の辞書 (本家の unicode-emoji-indexes と同じ形) */
export type UnicodeEmojiIndex = Record<string, string[] | undefined>

/**
 * Unicode 絵文字を英名とキーワード辞書で引く (#1193)。順位付けは本家
 * MkEmojiPicker の searchUnicode と同じ: 英名の完全一致 → (空白区切りなら
 * AND 検索) 英名の前方一致 → 辞書の前方一致 → 英名の部分一致 → 辞書の部分一致。
 */
export function searchUnicodeEmojis(
  query: string,
  emojis: readonly UnicodeEmojiDef[],
  indexes: readonly UnicodeEmojiIndex[],
  max = 100,
): UnicodeEmojiDef[] {
  const q = query.replace(/:/g, '').toLowerCase().trim()
  if (!q) return []

  const matches = new Set<UnicodeEmojiDef>()
  const full = () => matches.size >= max
  const collect = (test: (e: UnicodeEmojiDef) => boolean) => {
    for (const e of emojis) {
      if (full()) return
      if (test(e)) matches.add(e)
    }
  }

  const exact = emojis.find((e) => e.name === q)
  if (exact) matches.add(exact)

  if (q.includes(' ')) {
    const words = q.split(/\s+/)
    collect((e) => words.every((w) => e.name.includes(w)))
    for (const index of indexes) {
      collect((e) =>
        words.every((w) => index[e.char]?.some((k) => k.includes(w))),
      )
    }
  } else {
    collect((e) => e.name.startsWith(q))
    for (const index of indexes) {
      collect((e) => index[e.char]?.some((k) => k.startsWith(q)) ?? false)
    }
    collect((e) => e.name.includes(q))
    for (const index of indexes) {
      collect((e) => index[e.char]?.some((k) => k.includes(q)) ?? false)
    }
  }

  return [...matches]
}

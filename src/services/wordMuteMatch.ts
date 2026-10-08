import type { MutedWord } from '@/bindings'

/**
 * Misskey 本家の `check-word-mute` 準拠のワードミュート判定（#610）。
 *
 * フィルタ配列の各要素は:
 * - `string[]`: その語をすべて含めばマッチ（AND、本家同様 case-sensitive な `includes`）
 * - `string`: `/pattern/flags` 形式の正規表現としてマッチ（不正形式は無視）
 *
 * 要素間は OR（いずれか 1 つがマッチすれば true）。
 */

/** `/pattern/flags` 形式の文字列を RegExp に。不正なら null。 */
function buildRegex(pattern: string): RegExp | null {
  const m = pattern.match(/^\/(.+)\/(.*)$/)
  if (!m) return null
  try {
    return new RegExp(m[1] ?? '', m[2] ?? '')
  } catch {
    return null
  }
}

function matchesEntry(text: string, entry: MutedWord): boolean {
  if (Array.isArray(entry)) {
    if (entry.length === 0) return false
    return entry.every((kw) => kw.length > 0 && text.includes(kw))
  }
  const re = buildRegex(entry)
  return re ? re.test(text) : false
}

/** text に対し、words のいずれかのフィルタがマッチすれば true。 */
export function matchMutedWords(
  text: string | null | undefined,
  words: MutedWord[],
): boolean {
  if (!text || words.length === 0) return false
  return words.some((entry) => matchesEntry(text, entry))
}

/**
 * Minimal YAML-subset frontmatter parser/serializer for skill files.
 *
 * 受け付ける文法 (フラットな key: value):
 *   key: string             // クオート任意 (' or ")
 *   key: 123                // number
 *   key: true | false       // boolean
 *   key: [a, b, c]          // 文字列配列 (インライン)
 *   key:                    // 空文字列 (続く `- item` 行が無いとき)
 *   key:                    // 続く行が `  - item` パターンなら string[]
 *     - foo                 // (= 標準的な複数行 YAML 配列)
 *     - bar
 *
 * ネストしたオブジェクトはサポートしない (skill メタは flat 前提)。
 * 不正な行は黙ってスキップ。フロントマターが無いファイルは body 全体を返す。
 */

export type FrontmatterValue = string | number | boolean | string[]

export type Frontmatter = Record<string, FrontmatterValue>

export interface ParsedSkillFile {
  meta: Frontmatter
  body: string
}

// `\r?\n*` で frontmatter 終端 `---` 直後の **任意個** の空行を全部吸収する。
// `\n?` (高々 1 つ) だと defaults md の `---\n\n# heading` (= frontmatter と
// 本文の見た目 separator) で body 先頭に `\n# heading` が残り、エディタで
// 余分な空行 1 行として表示されてしまう。
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n*/

export function parseSkillFile(raw: string): ParsedSkillFile {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) return { meta: {}, body: raw }
  const meta = parseFrontmatter(m[1] ?? '')
  const body = raw.slice(m[0].length)
  return { meta, body }
}

function parseFrontmatter(text: string): Frontmatter {
  const out: Frontmatter = {}
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const rawLine = lines[i] ?? ''
    i++
    const line = rawLine.replace(/^\s+|\s+$/g, '')
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const valueRaw = line.slice(idx + 1).trim()
    if (valueRaw === '') {
      // 「key:」だけの行 → 続く `  - item` 群があれば string[] として収集。
      // 1 行も無ければ既存挙動どおり空文字列扱いに fallback。
      const collected = readBlockArrayItems(lines, i)
      if (collected.consumed > 0) {
        out[key] = collected.values
        i += collected.consumed
        continue
      }
      out[key] = ''
      continue
    }
    out[key] = parseValue(valueRaw)
  }
  return out
}

function readBlockArrayItems(
  lines: readonly string[],
  start: number,
): { values: string[]; consumed: number } {
  const values: string[] = []
  let i = start
  while (i < lines.length) {
    const next = lines[i] ?? ''
    const m = next.match(/^\s+-\s*(.*)$/)
    if (!m) break
    values.push(stripQuotes((m[1] ?? '').trim()))
    i++
  }
  return { values, consumed: i - start }
}

function parseValue(raw: string): FrontmatterValue {
  if (raw === '') return ''
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return parseInlineArray(raw)
  }
  // number (integer or float, no exponent)
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return stripQuotes(raw)
}

function parseInlineArray(raw: string): string[] {
  const inner = raw.slice(1, -1).trim()
  if (!inner) return []
  return inner.split(',').map((s) => stripQuotes(s.trim()))
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      return s.slice(1, -1)
    }
  }
  return s
}

export function serializeSkillFile(meta: Frontmatter, body: string): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue
    lines.push(`${key}: ${serializeValue(value)}`)
  }
  lines.push('---')
  // frontmatter と body の間に「空行 1 つ」を必ず挟む慣習を維持する。
  // body 自体の先頭改行は parseSkillFile 側で吸収済なので、ここで 1 つ足す。
  return `${lines.join('\n')}\n\n${body}`
}

function serializeValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(quoteIfNeeded).join(', ')}]`
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value)
  }
  return quoteIfNeeded(value)
}

const NEEDS_QUOTE = /[:#,[\]]|^\s|\s$|^$|^(true|false|null)$|^-?\d+(\.\d+)?$/

function quoteIfNeeded(s: string): string {
  if (NEEDS_QUOTE.test(s)) {
    return `'${s.replace(/'/g, "''")}'`
  }
  return s
}

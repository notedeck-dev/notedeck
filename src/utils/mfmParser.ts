/**
 * Pure MFM (Misskey Flavored Markdown) parser.
 * No Pinia / Vue / DOM dependencies — safe to import from Web Workers.
 *
 * The cache layer (parseMfm, warmCache, etc.) lives in mfm.ts which
 * re-exports everything from this file for convenience.
 */
import { char2twemojiUrl } from './twemoji'

export type MfmToken =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string }
  | { type: 'link'; label: MfmToken[]; url: string; silent?: boolean }
  | { type: 'mention'; username: string; host: string | null; acct: string }
  | { type: 'hashtag'; value: string }
  | { type: 'bold'; children: MfmToken[] }
  | { type: 'italic'; children: MfmToken[] }
  | { type: 'strike'; children: MfmToken[] }
  | { type: 'inlineCode'; value: string }
  | { type: 'customEmoji'; shortcode: string }
  | { type: 'unicodeEmoji'; value: string; url: string }
  | {
      type: 'fn'
      name: string
      args: Record<string, string | true>
      children: MfmToken[]
    }
  | { type: 'small'; children: MfmToken[] }
  | { type: 'center'; children: MfmToken[] }
  | { type: 'codeBlock'; lang: string | null; value: string }
  | { type: 'plain'; value: string }
  | { type: 'quote'; children: MfmToken[] }
  | { type: 'search'; query: string }
  | { type: 'mathInline'; value: string }
  | { type: 'mathBlock'; value: string }
  // Markdown 拡張 (memo 用、opt-in)。`parseTokens(text, { markdown: true })`
  // で有効化される。Misskey 本家の MFM には存在しないので、ノート表示では
  // 既存挙動を保つために明示 opt-in 設計とする (memo 表示でだけ有効化)。
  | { type: 'heading'; level: number; children: MfmToken[] }
  | { type: 'list'; ordered: boolean; items: MfmToken[][] }

export interface ParseOptions {
  /** Markdown 構文 (heading / list) を block レベルで解釈する。memo 用。 */
  markdown?: boolean
}

const emojiRegex =
  /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu

interface PatternDef {
  regex: RegExp
  parse: (m: RegExpExecArray) => MfmToken
}

/* Helper to safely extract capture group (guaranteed present after regex.exec match) */
const g = (m: RegExpExecArray, i: number): string => m[i] as string

const inlinePatterns: PatternDef[] = [
  {
    regex: /`([^`\n]+)`/g,
    parse: (m) => ({ type: 'inlineCode', value: g(m, 1) }),
  },
  {
    // http/https に加え、`memo:<id>` (#494) も link として受け入れる。
    // 安全な scheme のみホワイトリスト化 (data:/javascript: 等は弾く)。
    regex: /(\??)\[([^\]]+)\]\(((?:https?:\/\/[^\s)]+|memo:\d{14}))\)/g,
    parse: (m) => ({
      type: 'link',
      label: parseTokens(g(m, 2)),
      url: g(m, 3),
      silent: g(m, 1) === '?',
    }),
  },
  {
    regex: /https?:\/\/[.,a-zA-Z0-9_/:%#@$&?!~=+\-[\]()]+/g,
    parse: (m) => ({ type: 'url', value: g(m, 0) }),
  },
  {
    regex: /:([a-zA-Z0-9_]+(?:@[\w.-]+)?):/g,
    parse: (m) => ({
      type: 'customEmoji',
      shortcode: g(m, 1).replace(/@\.$/, ''),
    }),
  },
  {
    regex: /\*\*\*(.+?)\*\*\*/g,
    parse: (m) => ({
      type: 'bold',
      children: [
        { type: 'italic', children: parseTokens(g(m, 1)) } as MfmToken,
      ],
    }),
  },
  {
    regex: /\*\*(.+?)\*\*/g,
    parse: (m) => ({ type: 'bold', children: parseTokens(g(m, 1)) }),
  },
  {
    regex: /__(.+?)__/g,
    parse: (m) => ({ type: 'bold', children: parseTokens(g(m, 1)) }),
  },
  {
    regex: /(?<!\*)\*([^*\n]+?)\*(?!\*)/g,
    parse: (m) => ({ type: 'italic', children: parseTokens(g(m, 1)) }),
  },
  {
    regex: /(?<!_)_([^_\n]+?)_(?!_)/g,
    parse: (m) => ({ type: 'italic', children: parseTokens(g(m, 1)) }),
  },
  {
    regex: /~~(.+?)~~/g,
    parse: (m) => ({ type: 'strike', children: parseTokens(g(m, 1)) }),
  },
  {
    regex: /(?<=^|[\s(])@(\w+)(?:@([\w.-]+))?/g,
    parse: (m) => ({
      type: 'mention',
      username: g(m, 1),
      host: m[2] ?? null,
      acct: g(m, 0).trimStart(),
    }),
  },
  {
    regex:
      /(?<=^|[\s(])#([\w\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]+)/g,
    parse: (m) => ({ type: 'hashtag', value: g(m, 1) }),
  },
  {
    regex: /\\\((.+?)\\\)/g,
    parse: (m) => ({ type: 'mathInline', value: g(m, 1) }),
  },
  {
    regex: emojiRegex,
    parse: (m) => ({
      type: 'unicodeEmoji',
      value: g(m, 0),
      url: char2twemojiUrl(g(m, 0)),
    }),
  },
]

function parseQuoteBlock(
  text: string,
  pos: number,
  opts: ParseOptions,
): { end: number; token: MfmToken } | null {
  if (text[pos] !== '>') return null
  // Must be at start of text or preceded by newline
  if (pos > 0 && text[pos - 1] !== '\n') return null
  // Require space after >
  if (text[pos + 1] !== ' ') return null

  const lines: string[] = []
  let i = pos
  while (i < text.length) {
    if (text[i] !== '>' || text[i + 1] !== ' ') break
    const lineStart = i + 2
    const nlIdx = text.indexOf('\n', lineStart)
    if (nlIdx < 0) {
      lines.push(text.slice(lineStart))
      i = text.length
      break
    }
    lines.push(text.slice(lineStart, nlIdx))
    i = nlIdx + 1
  }

  if (lines.length === 0) return null

  const inner = lines.join('\n')
  return {
    end: i,
    token: { type: 'quote', children: parseTokens(inner, opts) },
  }
}

/**
 * Markdown ATX heading (`# heading` 〜 `###### heading`)。
 * 行頭でかつ `#` の連続後にスペースが必要。`#tag` (hashtag) とは衝突しない。
 */
function parseHeading(
  text: string,
  pos: number,
  opts: ParseOptions,
): { end: number; token: MfmToken } | null {
  if (pos > 0 && text[pos - 1] !== '\n') return null
  let level = 0
  while (level < 6 && text[pos + level] === '#') level++
  if (level === 0 || text[pos + level] !== ' ') return null
  const lineStart = pos + level + 1
  const nlIdx = text.indexOf('\n', lineStart)
  const end = nlIdx < 0 ? text.length : nlIdx + 1
  const content = text.slice(lineStart, nlIdx < 0 ? text.length : nlIdx)
  return {
    end,
    token: { type: 'heading', level, children: parseTokens(content, opts) },
  }
}

/**
 * Markdown list — `- item` / `* item` / `1. item`。連続する同形式の行をまとめる。
 * unordered の場合 marker (`-` か `*`) を統一して継続判定。
 */
function parseList(
  text: string,
  pos: number,
  opts: ParseOptions,
): { end: number; token: MfmToken } | null {
  if (pos > 0 && text[pos - 1] !== '\n') return null
  const orderedMatch = /^(\d+)\. /.exec(text.slice(pos))
  let ordered: boolean
  let firstMarker: string
  if (orderedMatch) {
    ordered = true
    firstMarker = orderedMatch[0] as string
  } else if (
    (text[pos] === '-' || text[pos] === '*') &&
    text[pos + 1] === ' '
  ) {
    ordered = false
    firstMarker = `${text[pos]} `
  } else {
    return null
  }

  const items: MfmToken[][] = []
  let i = pos
  while (i < text.length) {
    let prefixLen: number
    if (ordered) {
      const m = /^\d+\. /.exec(text.slice(i))
      if (!m) break
      prefixLen = (m[0] as string).length
    } else {
      // unordered は最初に検出した marker (`- ` or `* `) と一致する行のみ継続
      if (!text.startsWith(firstMarker, i)) break
      prefixLen = firstMarker.length
    }
    const lineStart = i + prefixLen
    const nlIdx = text.indexOf('\n', lineStart)
    const lineEnd = nlIdx < 0 ? text.length : nlIdx
    items.push(parseTokens(text.slice(lineStart, lineEnd), opts))
    i = nlIdx < 0 ? text.length : nlIdx + 1
  }

  if (items.length === 0) return null
  return {
    end: i,
    token: { type: 'list', ordered, items },
  }
}

function parseSearchBlock(
  text: string,
  pos: number,
): { end: number; token: MfmToken } | null {
  // Must be at start of text or preceded by newline
  if (pos > 0 && text[pos - 1] !== '\n') return null

  const nlIdx = text.indexOf('\n', pos)
  const line = nlIdx < 0 ? text.slice(pos) : text.slice(pos, nlIdx)
  const end = nlIdx < 0 ? text.length : nlIdx

  const searchMatch = /^(.+?) (検索|\[検索\]|Search|\[Search\])$/.exec(line)
  if (!searchMatch) return null

  return {
    end,
    token: { type: 'search', query: searchMatch[1] as string },
  }
}

function parseMathBlock(
  text: string,
  pos: number,
  _opts: ParseOptions,
): { end: number; token: MfmToken } | null {
  if (text[pos] !== '\\' || text[pos + 1] !== '[') return null
  // Must be at start of text or preceded by newline
  if (pos > 0 && text[pos - 1] !== '\n') return null

  const closeIdx = text.indexOf('\\]', pos + 2)
  if (closeIdx < 0) return null

  const value = text.slice(pos + 2, closeIdx)
  let end = closeIdx + 2
  // Consume trailing newline if present
  if (text[end] === '\n') end++

  return {
    end,
    token: { type: 'mathBlock', value },
  }
}

function parseCodeBlock(
  text: string,
  pos: number,
  _opts: ParseOptions,
): { end: number; token: MfmToken } | null {
  if (!text.startsWith('```', pos)) return null
  // Must be at start of text or preceded by newline
  if (pos > 0 && text[pos - 1] !== '\n') return null
  let i = pos + 3
  // Optional language identifier (until newline)
  const nlIdx = text.indexOf('\n', i)
  if (nlIdx < 0) return null
  const lang = text.slice(i, nlIdx).trim() || null
  i = nlIdx + 1
  // Find closing ```
  const closeIdx = text.indexOf('\n```', i)
  if (closeIdx < 0) return null
  const value = text.slice(i, closeIdx)
  return {
    end: closeIdx + 4,
    token: { type: 'codeBlock', lang, value },
  }
}

function parseFnBlock(
  text: string,
  pos: number,
  opts: ParseOptions,
): { end: number; token: MfmToken } | null {
  if (text[pos] !== '$' || text[pos + 1] !== '[') return null
  let i = pos + 2

  const nameMatch = /^\w+/.exec(text.slice(i))
  if (!nameMatch) return null
  const name = nameMatch[0]
  i += name.length

  const args: Record<string, string | true> = {}
  if (text[i] === '.') {
    i++
    const argsMatch = /^[^\s\]]+/.exec(text.slice(i))
    if (argsMatch) {
      for (const part of argsMatch[0].split(',')) {
        const eq = part.indexOf('=')
        if (eq >= 0) {
          args[part.slice(0, eq)] = part.slice(eq + 1)
        } else {
          args[part] = true
        }
      }
      i += argsMatch[0].length
    }
  }

  if (text[i] !== ' ') return null
  i++

  // 括弧の対応を数える。`$[fn]` の入れ子だけでなく、リンク `[label]` /
  // サイレントリンク `?[label]` のような `[...]` も `[` で +1 / `]` で -1 して
  // バランスさせる。そうしないとリンクラベルを閉じる `]` が fn を早期に閉じてしまう。
  let depth = 1
  const contentStart = i
  while (i < text.length && depth > 0) {
    if (text[i] === '[') {
      depth++
      i++
    } else if (text[i] === ']') {
      depth--
      if (depth === 0) break
      i++
    } else {
      i++
    }
  }

  if (depth !== 0) return null

  const content = text.slice(contentStart, i)
  return {
    end: i + 1,
    token: { type: 'fn', name, args, children: parseTokens(content, opts) },
  }
}

const tagTypeMap: Record<string, MfmToken['type']> = {
  small: 'small',
  center: 'center',
  plain: 'plain',
  b: 'bold',
  i: 'italic',
  s: 'strike',
}

function parseTagBlock(
  text: string,
  pos: number,
  opts: ParseOptions,
): { end: number; token: MfmToken } | null {
  for (const tag of ['small', 'center', 'plain', 'b', 'i', 's'] as const) {
    const open = `<${tag}>`
    if (!text.startsWith(open, pos)) continue
    const close = `</${tag}>`
    const closeIdx = text.indexOf(close, pos + open.length)
    if (closeIdx < 0) continue
    const content = text.slice(pos + open.length, closeIdx)
    const end = closeIdx + close.length
    if (tag === 'plain') {
      return { end, token: { type: 'plain', value: content } }
    }
    const type = tagTypeMap[tag] as
      | 'small'
      | 'center'
      | 'bold'
      | 'italic'
      | 'strike'
    return { end, token: { type, children: parseTokens(content, opts) } }
  }
  return null
}

type BlockMatch = { index: number; consumeLength: number; token: MfmToken }

function findFirstBlock(
  text: string,
  needle: string,
  tryParse: (
    text: string,
    pos: number,
    opts: ParseOptions,
  ) => { end: number; token: MfmToken } | null,
  opts: ParseOptions,
): BlockMatch | null {
  let from = 0
  while (from < text.length) {
    const idx = text.indexOf(needle, from)
    if (idx < 0) return null
    const result = tryParse(text, idx, opts)
    if (result) {
      return {
        index: idx,
        consumeLength: result.end - idx,
        token: result.token,
      }
    }
    from = idx + 1
  }
  return null
}

function findFirstSearchBlock(text: string): BlockMatch | null {
  const searchRe = /(?:^|\n)(.+?) (検索|\[検索\]|Search|\[Search\])(?:\n|$)/g
  const m = searchRe.exec(text)
  if (!m) return null
  const index = m[0].startsWith('\n') ? m.index + 1 : m.index
  const result = parseSearchBlock(text, index)
  if (!result) return null
  return {
    index,
    consumeLength: result.end - index,
    token: result.token,
  }
}

/**
 * Markdown list 用の専用 finder。`-`, `*`, 数字 はテキスト中に頻出するため、
 * findFirstBlock の単純な needle 検索ではなく行頭 marker を regex で
 * 検出してから parseList に委ねる。
 */
function findFirstListBlock(
  text: string,
  opts: ParseOptions,
): BlockMatch | null {
  const re = /(?:^|\n)(?:[-*] |\d+\. )/g
  const m = re.exec(text)
  if (!m) return null
  const index = m[0].startsWith('\n') ? m.index + 1 : m.index
  const result = parseList(text, index, opts)
  if (!result) return null
  return {
    index,
    consumeLength: result.end - index,
    token: result.token,
  }
}

export function parseTokens(text: string, opts: ParseOptions = {}): MfmToken[] {
  if (!text) return []

  const tokens: MfmToken[] = []
  let remaining = text

  while (remaining.length > 0) {
    let earliest: BlockMatch | null = null

    // Block-level patterns
    const blockCandidates = [
      findFirstBlock(remaining, '```', parseCodeBlock, opts),
      findFirstBlock(remaining, '$[', parseFnBlock, opts),
      findFirstBlock(remaining, '<small>', parseTagBlock, opts),
      findFirstBlock(remaining, '<center>', parseTagBlock, opts),
      findFirstBlock(remaining, '<plain>', parseTagBlock, opts),
      findFirstBlock(remaining, '<b>', parseTagBlock, opts),
      findFirstBlock(remaining, '<i>', parseTagBlock, opts),
      findFirstBlock(remaining, '<s>', parseTagBlock, opts),
      findFirstBlock(remaining, '>', parseQuoteBlock, opts),
      findFirstBlock(remaining, '\\[', parseMathBlock, opts),
      findFirstSearchBlock(remaining),
      // Markdown 拡張 (memo 用 opt-in)
      opts.markdown ? findFirstBlock(remaining, '#', parseHeading, opts) : null,
      opts.markdown ? findFirstListBlock(remaining, opts) : null,
    ]
    for (const c of blockCandidates) {
      if (c && (!earliest || c.index < earliest.index)) {
        earliest = c
      }
    }

    // Inline patterns
    for (const pattern of inlinePatterns) {
      pattern.regex.lastIndex = 0
      const m = pattern.regex.exec(remaining)
      if (m && (!earliest || m.index < earliest.index)) {
        earliest = {
          index: m.index,
          consumeLength: g(m, 0).length,
          token: pattern.parse(m),
        }
      }
    }

    if (!earliest) {
      tokens.push({ type: 'text', value: remaining })
      break
    }

    if (earliest.index > 0) {
      tokens.push({ type: 'text', value: remaining.slice(0, earliest.index) })
    }

    tokens.push(earliest.token)
    remaining = remaining.slice(earliest.index + earliest.consumeLength)
  }

  return tokens
}

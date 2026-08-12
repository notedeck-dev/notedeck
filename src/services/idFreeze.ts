/**
 * ID 凍結の最小変換 (#913)。
 *
 * ID 欠損ファイルへ「現在の実効値」を書き戻す際の変換は、パースした
 * 生内容への最小変換 (ID の追記のみ) でなければならない:
 * - 同一入力から常に同一バイト列 (揮発デフォルトの混入禁止 —
 *   達成済み判定の内容一致が偽陰性になる)
 * - 手書きコメント・整形を保持する
 * - 既存の不正 id 値は「後勝ち」で上書きする (JSON5 の重複キーと
 *   frontmatter パーサはどちらも後の宣言が勝つ)
 *
 * 呼び出し側の契約: raw はパース成功済みであること (パース不能
 * ファイルは凍結対象外)。
 */

/** JSON5 の単一クオート文字列としてエスケープする。 */
function quoteJson5(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
  return `'${escaped}'`
}

/**
 * オブジェクトリテラルの「最後の有意文字 2 つ」を探す。
 * 文字列・コメント内の文字は有意と数えない。
 */
function findTailSignificants(
  raw: string,
): { closeBrace: number; before: { ch: string; idx: number } } | null {
  let last: { ch: string; idx: number } | null = null
  let prev: { ch: string; idx: number } | null = null
  let i = 0
  while (i < raw.length) {
    const ch = raw[i] as string
    if (ch === '/' && raw[i + 1] === '/') {
      const nl = raw.indexOf('\n', i)
      i = nl === -1 ? raw.length : nl + 1
      continue
    }
    if (ch === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2)
      i = end === -1 ? raw.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      // 文字列全体を 1 つの有意トークンとして先頭のみ記録
      prev = last
      last = { ch, idx: i }
      i++
      while (i < raw.length) {
        if (raw[i] === '\\') {
          i += 2
          continue
        }
        if (raw[i] === ch) {
          // 文字列の終端も有意扱いにして prev/last を文字列末尾へ寄せる
          prev = last
          last = { ch: raw[i] as string, idx: i }
          i++
          break
        }
        i++
      }
      continue
    }
    if (!/\s/.test(ch)) {
      prev = last
      last = { ch, idx: i }
    }
    i++
  }
  if (last?.ch !== '}' || !prev) return null
  return { closeBrace: last.idx, before: prev }
}

/**
 * JSON5 オブジェクトファイルへ ID メンバーを注入する。
 * 挿入位置は「最後の有意メンバーの直後」なので、末尾コメントは
 * そのまま残り、既存の同名キーには後勝ちで優先する。
 */
export function injectJson5Id(raw: string, key: string, value: string): string {
  const tail = findTailSignificants(raw)
  if (!tail) {
    throw new Error('injectJson5Id: not a JSON5 object literal')
  }
  const { before } = tail
  const member = `${key}: ${quoteJson5(value)}`
  const needsComma = before.ch !== '{' && before.ch !== ','
  const insert = `${needsComma ? ',' : ''}\n  ${member},\n`
  const at = before.idx + 1
  return raw.slice(0, at) + insert + raw.slice(at)
}

const FRONTMATTER_RE = /^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n)/

/**
 * skill ファイルの frontmatter へ id を注入する。
 * 既存 frontmatter があれば閉じ `---` の直前に行を足し
 * (パーサは後勝ち)、無ければ frontmatter ごと作る。
 */
export function injectFrontmatterId(raw: string, value: string): string {
  const quoted = `'${value.replace(/'/g, "''")}'`
  const m = FRONTMATTER_RE.exec(raw)
  if (!m || m.index === undefined) {
    return `---\nid: ${quoted}\n---\n\n${raw}`
  }
  // 開きデリミタ長はマッチから導く (CRLF なら `---\r\n` = 5)。
  // 固定値にすると改行コードの違いで挿入位置が 1 ずれて行が壊れる
  const openLen = '---'.length + (m[1] ?? '\n').length
  const inner = m[2] ?? ''
  const innerEnd = m.index + openLen + inner.length
  return `${raw.slice(0, innerEnd)}${m[3]}id: ${quoted}${raw.slice(innerEnd)}`
}

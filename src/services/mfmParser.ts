/**
 * MFM (Misskey Flavored Markdown) parser.
 * 構文解析は本家 frontend と同じ mfm-js に任せ、ここには NoteDeck 独自の memo 向け
 * 拡張 (markdown の heading / list、`memo:<id>` リンク) だけを置く。
 * Pinia / Vue / DOM に依存しない (Web Worker からも読む)。
 *
 * キャッシュ層 (parseMfm, warmCache など) は utils/mfm.ts。
 */
import * as mfm from 'mfm-js'

export type MfmHeading = {
  type: 'heading'
  props: { level: number }
  children: mfm.MfmNode[]
}
export type MfmList = {
  type: 'list'
  props: { ordered: boolean; items: mfm.MfmNode[][] }
}
/** mfm-js のノードに memo 向け拡張を足したもの。ノート本文は mfm-js の範囲だけ */
export type MfmNode = mfm.MfmNode | MfmHeading | MfmList

export interface ParseOptions {
  /**
   * memo 向け拡張を有効にする: markdown の heading / list を block として解釈し、
   * `[label](memo:<id>)` を link にする (#494)。本家の MFM には無いので
   * ノート本文では使わない (MemoCard だけが opt-in する)。
   */
  markdown?: boolean
}

export function parseTokens(text: string, opts: ParseOptions = {}): MfmNode[] {
  if (!text) return []
  return opts.markdown ? parseMemo(text) : mfm.parse(text)
}

// mfm-js の link は http(s) しか受けない。`memo:<id>` は解析前に .invalid の
// URL に置き換え、解析後に戻す。ラベルの中の絵文字や装飾、$[fn] の入れ子は
// そのまま mfm-js が面倒を見る
const MEMO_LINK_RE = /\]\(memo:(\d{14})\)/g
const MEMO_SENTINEL_HOST = 'notedeck-memo.invalid'
const MEMO_SENTINEL_RE = new RegExp(
  `https://${MEMO_SENTINEL_HOST.replace('.', '\\.')}/(\\d{14})`,
  'g',
)

function parseWithMemoLinks(text: string): mfm.MfmNode[] {
  const replaced = text.replace(
    MEMO_LINK_RE,
    `](https://${MEMO_SENTINEL_HOST}/$1)`,
  )
  const nodes = mfm.parse(replaced)
  if (replaced === text) return nodes
  mfm.inspect(nodes, (node) => {
    // link 以外にも戻すのは、コードの中に書かれた記法を原文のまま見せるため
    switch (node.type) {
      case 'link':
        node.props.url = node.props.url.replace(MEMO_SENTINEL_RE, 'memo:$1')
        break
      case 'text':
        node.props.text = node.props.text.replace(MEMO_SENTINEL_RE, 'memo:$1')
        break
      case 'inlineCode':
      case 'blockCode':
        node.props.code = node.props.code.replace(MEMO_SENTINEL_RE, 'memo:$1')
        break
    }
  })
  return nodes
}

const HEADING_RE = /^(#{1,6}) (.*)$/
const LIST_RE = /^(?:(\d+\. )|([-*] ))/

/**
 * 行頭の markdown ブロック (heading / list) を切り出し、残りの行はまとめて
 * mfm-js に渡す。コードブロックの中は見ない。quote の中などは mfm-js に任せる
 * ので heading にはならない
 */
function parseMemo(text: string): MfmNode[] {
  const out: MfmNode[] = []
  const lines = text.split('\n')
  let chunk: string[] = []
  let inFence = false
  const flush = () => {
    if (chunk.length === 0) return
    out.push(...parseWithMemoLinks(chunk.join('\n')))
    chunk = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    if (line.startsWith('```')) inFence = !inFence
    if (inFence) {
      chunk.push(line)
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      flush()
      out.push({
        type: 'heading',
        props: { level: (heading[1] as string).length },
        children: parseWithMemoLinks(heading[2] as string),
      })
      continue
    }

    const list = LIST_RE.exec(line)
    if (list) {
      flush()
      const ordered = list[1] !== undefined
      // unordered は最初の記号 (`- ` / `* `) と同じ行だけ続ける
      const marker = list[2]
      const items: mfm.MfmNode[][] = []
      for (; i < lines.length; i++) {
        const m = LIST_RE.exec(lines[i] as string)
        if (!m || (ordered ? m[1] === undefined : m[2] !== marker)) break
        items.push(parseWithMemoLinks((lines[i] as string).slice(m[0].length)))
      }
      i--
      out.push({ type: 'list', props: { ordered, items } })
      continue
    }

    chunk.push(line)
  }
  flush()
  return out
}

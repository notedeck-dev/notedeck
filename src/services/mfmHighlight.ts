/**
 * MFM エディターの色付け (#1392)。ソースの文字列から「どの範囲を何色にするか」だけを
 * 返す。文字列そのものには触らない。
 *
 * MFM は空白と改行をそのまま表示する書式なので、入れ子を見やすくするためにソースを
 * 整形 (改行や字下げ) すると、表示が変わってしまう。代わりに、入れ子の深さを色で示す:
 * `$[名前` と対応する `]` に同じ深さを付ける。
 *
 * mfm-js の構文木は位置を持たないので、ここは色付け専用の走査器。本家の構文を厳密に
 * 再現するものではなく、迷ったら「色を付けない」側に倒す (誤って色が付くより、付かない
 * 方が害が無い)。
 */

export type MfmHighlightKind =
  | 'fn'
  | 'fnArgs'
  | 'mark'
  | 'emoji'
  | 'mention'
  | 'hashtag'
  | 'url'
  | 'code'

export interface MfmHighlightRange {
  from: number
  to: number
  kind: MfmHighlightKind
  /** 関数の入れ子の深さ (外側が 0)。`fn` / `fnArgs` だけ */
  depth?: number
}

// 位置を指定して 1 回だけ試す (sticky)。lastIndex を毎回入れてから使う
const FN_OPEN = /\$\[([a-z0-9_]+)(\.[^\s[\]]*)?(?=\s)/y
const LINK = /\??\[[^\]\n]*\]\((https?:\/\/[^\s)]+)\)/y
const URL = /https?:\/\/[^\s<>()[\]]+/y
const EMOJI = /:[a-zA-Z0-9_+-]+(?:@[a-zA-Z0-9_.-]+)?:/y
const MENTION = /@[a-zA-Z0-9_]+(?:@[a-zA-Z0-9_.-]*[a-zA-Z0-9])?/y
// 和文の句読点 (。、，．！？) でも切る。直書きすると文言の lint に数えられるので符号で書く
const HASHTAG = /#[^\s#[\]<>()\u3002\u3001\uff0c\uff0e,.!?\uff01\uff1f:;'"`]+/y
const CODE_BLOCK = /```[\s\S]*?```/y
const INLINE_CODE = /`[^`\n]+`/y
const TAG = /<\/?(?:center|small|i|b|plain)>/y
const MARKERS = ['***', '**', '~~']

/** 位置 `at` で正規表現を 1 回試す */
function matchAt(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at
  return re.exec(text)
}

/** 直前が語の文字か (メンションやハッシュタグは語の途中では始まらない) */
function afterWordChar(text: string, at: number): boolean {
  return at > 0 && /[a-zA-Z0-9_]/.test(text[at - 1] ?? '')
}

export function mfmHighlightRanges(text: string): MfmHighlightRange[] {
  const out: MfmHighlightRange[] = []
  /** 開いている関数の深さの積み重ね */
  let depth = 0
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (ch === '`') {
      const code = matchAt(CODE_BLOCK, text, i) ?? matchAt(INLINE_CODE, text, i)
      if (code) {
        out.push({ from: i, to: i + code[0].length, kind: 'code' })
        i += code[0].length
        continue
      }
    }

    if (ch === '<') {
      const tag = matchAt(TAG, text, i)
      if (tag) {
        out.push({ from: i, to: i + tag[0].length, kind: 'mark' })
        i += tag[0].length
        // <plain> の中は解釈しない。閉じタグまで飛ばす
        if (tag[0] === '<plain>') {
          const close = text.indexOf('</plain>', i)
          if (close >= 0) i = close
        }
        continue
      }
    }

    if (ch === '$') {
      const fn = matchAt(FN_OPEN, text, i)
      if (fn) {
        const nameEnd = i + 2 + (fn[1]?.length ?? 0)
        out.push({ from: i, to: nameEnd, kind: 'fn', depth })
        if (fn[2]) {
          out.push({
            from: nameEnd,
            to: nameEnd + fn[2].length,
            kind: 'fnArgs',
            depth,
          })
        }
        depth++
        i += fn[0].length
        continue
      }
    }

    if (ch === ']' && depth > 0) {
      depth--
      out.push({ from: i, to: i + 1, kind: 'fn', depth })
      i++
      continue
    }

    if (ch === '[' || ch === '?') {
      const link = matchAt(LINK, text, i)
      if (link?.[1]) {
        const urlFrom = i + link[0].length - 1 - link[1].length
        out.push({ from: urlFrom, to: urlFrom + link[1].length, kind: 'url' })
        i += link[0].length
        continue
      }
    }

    if (ch === 'h') {
      const url = !afterWordChar(text, i) ? matchAt(URL, text, i) : null
      if (url) {
        out.push({ from: i, to: i + url[0].length, kind: 'url' })
        i += url[0].length
        continue
      }
    }

    if (ch === ':') {
      const emoji = matchAt(EMOJI, text, i)
      if (emoji) {
        out.push({ from: i, to: i + emoji[0].length, kind: 'emoji' })
        i += emoji[0].length
        continue
      }
    }

    if (ch === '@' && !afterWordChar(text, i)) {
      const mention = matchAt(MENTION, text, i)
      if (mention) {
        out.push({ from: i, to: i + mention[0].length, kind: 'mention' })
        i += mention[0].length
        continue
      }
    }

    if (ch === '#' && !afterWordChar(text, i)) {
      const tag = matchAt(HASHTAG, text, i)
      if (tag) {
        out.push({ from: i, to: i + tag[0].length, kind: 'hashtag' })
        i += tag[0].length
        continue
      }
    }

    if (ch === '*' || ch === '~') {
      const marker = MARKERS.find((m) => text.startsWith(m, i))
      if (marker) {
        out.push({ from: i, to: i + marker.length, kind: 'mark' })
        i += marker.length
        continue
      }
    }

    i++
  }
  return out
}

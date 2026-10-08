import { describe, expect, it, vi } from 'vitest'
import {
  highlightCode,
  highlightCodeTokens,
  highlighterLoaded,
} from './highlight'

// 「Shiki のトークン色は CSS 変数経由で、色の直書きを出力に含めない」(#1050)。
// 色ごとのクラス (.shiki-<hex>) だと、カスタム CSS から上書きするのに元の hex を
// 知っている必要があった。ここが落ちたら global.css の変数で色を決める約束が
// 壊れている。
//
// Shiki は 1 行のトークナイズに時間上限を持ち、超えた残りは直前のトークンに
// 畳まれる。全体テストの高負荷下では短い行でも掛かることがあるので、検査する
// トークンは行頭に置く (行頭のトークンは上限の前に必ず 1 つ取れる)。
// pre 要素の有無は happy-dom 上の DOMPurify が pre ごと落とすため見ない
// (実ブラウザでは残る。pre.shiki の構造は tests/utils/highlight.test.ts が見る)

const TS_SNIPPET = 'const a = 1\n"x"\n// c'
const JSON_SNIPPET = 'true\n1\n"s"'

async function ready(): Promise<void> {
  // lang 付きの最初の呼び出しが遅延初期化をトリガーする
  highlightCode(TS_SNIPPET, 'typescript')
  await vi.waitFor(() => expect(highlighterLoaded.value).toBe(true), {
    timeout: 15000,
  })
  // 文法の正規表現は初回のトークナイズで compile されるので 1 回空振りして温める
  highlightCode(TS_SNIPPET, 'typescript')
  highlightCode(JSON_SNIPPET, 'json')
}

describe('highlightCode — トークン色は CSS 変数 (#1050)', () => {
  it('キーワード / 文字列 / コメントの色が var(--nd-code-token-*) で出る', async () => {
    await ready()
    const html = highlightCode(TS_SNIPPET, 'typescript')
    expect(html).toContain(
      '<span style="color:var(--nd-code-token-keyword)">const</span>',
    )
    expect(html).toContain('color:var(--nd-code-token-string)')
    expect(html).toContain('color:var(--nd-code-token-comment)')
  }, 20000)

  it('hex の直書き (色ごとのクラス / inline の #rrggbb) を含まない', async () => {
    await ready()
    const html = highlightCode(JSON_SNIPPET, 'json')
    expect(html).toMatch(/color:var\(--nd-code-token-[a-z-]+\)/)
    expect(html).not.toMatch(/class="shiki-[0-9a-f]/)
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/)
    expect(html).toContain('color:var(--nd-code-token-number)')
  }, 20000)

  it('既定の前景色のトークンは span を付けず pre.shiki の色に任せる', async () => {
    await ready()
    const html = highlightCode('a = b', 'typescript')
    expect(html).not.toContain('var(--nd-codeEditorFg)')
  }, 20000)

  it('highlightCodeTokens は span 列だけを返し、同じく変数で色を乗せる', async () => {
    await ready()
    const inner = highlightCodeTokens(TS_SNIPPET, 'typescript')
    expect(inner).not.toBeNull()
    expect(inner).not.toContain('<pre')
    expect(inner).toContain('color:var(--nd-code-token-string)')
    expect(highlightCodeTokens('x', 'definitely-not-a-lang')).toBeNull()
  }, 20000)
})

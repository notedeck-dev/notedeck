import { describe, expect, it, vi } from 'vitest'
import { highlightCode, highlighterLoaded } from '@/utils/highlight'

// dompurify は window 必須で node 環境では sanitize を持たないため、
// パススルーの最小モックに差し替える (sanitize 自体は検証対象外)
vi.mock('dompurify', () => ({
  default: { sanitize: (html: string) => html },
}))

describe('highlightCode (fallback path)', () => {
  it('returns escaped plain HTML when lang is null', () => {
    expect(highlightCode('const a = 1', null)).toBe(
      '<pre><code>const a = 1</code></pre>',
    )
  })

  it('escapes &, < and > in the fallback output', () => {
    expect(highlightCode('<a> && <b>', null)).toBe(
      '<pre><code>&lt;a&gt; &amp;&amp; &lt;b&gt;</code></pre>',
    )
  })

  it('handles empty code', () => {
    expect(highlightCode('', null)).toBe('<pre><code></code></pre>')
  })
})

describe('highlightCode (after highlighter init)', () => {
  it('highlights known languages and keeps unknown ones as fallback', async () => {
    // 最初の lang 付き呼び出しが遅延初期化をトリガーし、それまではフォールバック
    expect(highlightCode('const a = 1', 'typescript')).toBe(
      '<pre><code>const a = 1</code></pre>',
    )

    await vi.waitFor(
      () => {
        expect(highlighterLoaded.value).toBe(true)
      },
      { timeout: 15000 },
    )

    const html = highlightCode('const a = 1', 'typescript')
    expect(html).toContain('<pre class="shiki')
    expect(html).toContain('const')

    // エイリアス解決 (ts → typescript ではなく tsx → typescript を確認)
    const aliased = highlightCode('const a = 1', 'tsx')
    expect(aliased).toContain('<pre class="shiki')

    // 未知の言語は初期化後もフォールバック
    expect(highlightCode('x', 'definitely-not-a-lang')).toBe(
      '<pre><code>x</code></pre>',
    )
  }, 20000)
})

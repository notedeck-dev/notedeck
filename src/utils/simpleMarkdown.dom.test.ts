import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderSimpleMarkdown } from './simpleMarkdown'

const highlightCodeTokens = vi.hoisted(() =>
  vi.fn<
    (
      code: string,
      lang: string | null,
    ) => { html: string; fgClass: string } | null
  >(),
)

vi.mock('./highlight', () => ({ highlightCodeTokens }))

describe('renderSimpleMarkdown — コードブロック', () => {
  beforeEach(() => {
    highlightCodeTokens.mockReset()
    highlightCodeTokens.mockReturnValue(null)
  })

  it('ハイライトできない言語は素のエスケープで出す', () => {
    const html = renderSimpleMarkdown('```unknown\nlet x = 1 < 2\n```')
    expect(html).toContain('let x = 1 &lt; 2')
    expect(html).not.toContain('class="shiki')
  })

  it('ハイライトできたらトークンの span を残す', () => {
    highlightCodeTokens.mockReturnValue({
      html: '<span class="shiki-569cd6">let</span> x',
      fgClass: 'shiki-d4d4d4',
    })
    const html = renderSimpleMarkdown('```aiscript\nlet x\n```')
    // span は sanitize の allowlist を通る
    expect(html).toContain('<span class="shiki-569cd6">let</span>')
    // 前景色クラスは code 側に乗る (pre 側の shiki クラスは happy-dom 上の
    // DOMPurify が pre ごと落とすため、ここでは検証しない — 実ブラウザでは残る)
    expect(html).toContain('class="shiki-d4d4d4"')
  })

  it('diff は Shiki に渡さず行単位で塗る (増減が読み取れる色にする)', () => {
    const html = renderSimpleMarkdown('```diff\n+added\n-removed\n keep\n```')
    expect(highlightCodeTokens).not.toHaveBeenCalled()
    expect(html).toContain('nd-md-diff-add')
    expect(html).toContain('nd-md-diff-del')
    // 文脈行にも行 span は付く (増減クラスは付かない)
    expect(html).toContain('<span class="nd-md-diff-line"> keep</span>')
  })

  it('diff の行 span は改行文字を挟まない (1 行おきの空行を作らない)', () => {
    const html = renderSimpleMarkdown('```diff\n+a\n+b\n```')
    expect(html).toContain(
      '</span><span class="nd-md-diff-line nd-md-diff-add">+b</span>',
    )
  })

  it('言語キーをそのままハイライタへ渡す', () => {
    renderSimpleMarkdown('```python\nx = 1\n```')
    expect(highlightCodeTokens).toHaveBeenCalledWith('x = 1', 'python')
  })

  it('言語指定なしのフェンスも壊さない', () => {
    const html = renderSimpleMarkdown('```\nplain\n```')
    expect(highlightCodeTokens).toHaveBeenCalledWith('plain', null)
    expect(html).toContain('plain')
  })

  it('コピーボタンの構造を保つ (textContent がコード本体になる)', () => {
    const html = renderSimpleMarkdown('```\ncode body\n```')
    expect(html).toContain('data-md-copy="1"')
    expect(html.indexOf('data-md-copy')).toBeLessThan(html.indexOf('<code'))
  })
})

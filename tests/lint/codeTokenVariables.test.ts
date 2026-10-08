// 「Shiki のトークン色の変数 (--nd-code-token-*) は global.css の 1 箇所で、
// 明暗の両方に揃っている」を機械検査に落とす (#1050)。
//
// 役割の一覧は src/utils/highlightTheme.ts が正本。役割を足して変数を書き忘れると
// そのトークンだけ色が消える (var() が未定義 → 継承) が、見た目でしか気づけない。
// 逆に、変数の定義が別のファイルに散ると「ここを直せば両方に効く」が壊れる。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ND_CODE_TOKEN_ROLES } from '@/utils/highlightTheme'

const ROOT = resolve(import.meta.dirname, '../..')
const GLOBAL_CSS = join(ROOT, 'src/styles/global.css')

/** `selector {` から対応する `}` までの中身 */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} のブロックが global.css に無い`).toBeGreaterThan(
    -1,
  )
  const end = css.indexOf('\n}', start)
  return css.slice(start, end)
}

function defined(cssBlock: string, role: string): string | null {
  const m = cssBlock.match(
    new RegExp(`--nd-code-token-${role}:\\s*([^;]+);`, 'm'),
  )
  return m?.[1]?.trim() ?? null
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (/\.(ts|vue|css|scss)$/.test(entry.name)) yield p
  }
}

describe('Shiki トークン色の変数 (#1050)', () => {
  const css = readFileSync(GLOBAL_CSS, 'utf8')
  const dark = block(css, ':root')
  const light = block(css, ":root[data-nd-code-scheme='light']")

  it('全役割が :root (dark) で定義されている', () => {
    const missing = ND_CODE_TOKEN_ROLES.filter((r) => defined(dark, r) === null)
    expect(missing).toEqual([])
  })

  it('全役割が light でも決まる (light ブロックで定義するか、エディタ側の変数を指す)', () => {
    const missing = ND_CODE_TOKEN_ROLES.filter((r) => {
      if (defined(light, r) !== null) return false
      const darkValue = defined(dark, r) ?? ''
      // --nd-codeKeyword / --nd-codeEditorFg 等は light ブロック側で切り替わる
      return !/^var\(--nd-code[A-Z]/.test(darkValue)
    })
    expect(missing).toEqual([])
  })

  it('light ブロックに正本に無い役割を書いていない', () => {
    const roles = new Set<string>(ND_CODE_TOKEN_ROLES)
    const stray = [...light.matchAll(/--nd-code-token-([a-z-]+):/g)]
      .map((m) => m[1] ?? '')
      .filter((r) => !roles.has(r))
    expect(stray).toEqual([])
  })

  it('変数の定義は global.css 以外に無い', () => {
    const offenders: string[] = []
    for (const file of walk(join(ROOT, 'src'))) {
      if (file === GLOBAL_CSS) continue
      const text = readFileSync(file, 'utf8')
      if (/--nd-code-token-[a-z-]+:/.test(text)) {
        offenders.push(relative(ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })
})

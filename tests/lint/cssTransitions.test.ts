// 「アニメーションは compositor-only」を機械検査に落とす (#1098)。
//
// DEVELOPMENT.md の "CSS レンダリング規約" は transform / opacity / translate /
// scale / rotate 以外の transition を禁止し、box-shadow / border-radius /
// clip-path / backdrop-filter はペイント誘発として同じく禁止している。文書は
// 「全コンポーネント監査済み」と書いていたが、監査時点で layout / paint
// プロパティの transition が十数ファイルに残っていた。人の注意力で守る規約は
// 守られない。
//
// 検査対象は `transition` / `transition-property` 宣言だけ。@keyframes の中身は
// 見ていない (プロパティが宣言ブロックに散るので別途)。色 (color / background /
// border-color 等) はペイントだが規約が禁止していないので通す。
//
// 方針はラチェット。既存の違反は ALLOWED に "パス: プロパティ" で凍結し、
// 新しい違反は落とす。直したら ALLOWED から消す。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')

/** layout を誘発するプロパティ (前方一致)。 */
const LAYOUT = [
  'all',
  'width',
  'height',
  'min-',
  'max-',
  'top',
  'left',
  'right',
  'bottom',
  'inset',
  'margin',
  'padding',
  'gap',
  'flex',
  'grid',
  'font-size',
  'line-height',
  'border-width',
]
/** ペイントを誘発するプロパティ (規約が名指しで禁止)。 */
const PAINT = ['box-shadow', 'border-radius', 'clip-path', 'backdrop-filter']

/** 凍結した既存違反: "src 相対パス: プロパティ" → 理由 */
const FROZEN =
  '凍結 (#1098): 監査時点の残存。transform / opacity に置き換えて消す'
const ALLOWED: Record<string, string> = {
  'src/components/common/MkPoll.vue: width':
    '凍結 (#1098): DEVELOPMENT.md は scaleX 化済みと書いているが width の transition が残っている',
  'src/components/deck/DayNightToggle.vue: height': FROZEN,
  'src/components/deck/DayNightToggle.vue: width': FROZEN,
  'src/components/deck/DeckLookupColumn.vue: width': FROZEN,
  'src/components/dev/DevDashboard.vue: height': FROZEN,
  'src/components/dev/DevDashboard.vue: width': FROZEN,
  'src/components/window/AboutContent.vue: width': FROZEN,
}

function styleFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...styleFiles(path))
    else if (/\.(vue|css|scss)$/.test(entry.name)) out.push(path)
  }
  return out
}

/** transition 宣言から遷移対象プロパティ名を取り出す。 */
function transitionedProps(css: string): string[] {
  const props: string[] = []
  const decl = /(?:^|[;{\s])transition(?:-property)?\s*:\s*([^;}]+)/g
  for (const m of css.matchAll(decl)) {
    // cubic-bezier(a, b, c, d) / var(--x, y) の中のカンマを潰してから分割
    const value = m[1].replace(/\([^)]*\)/g, '()')
    for (const item of value.split(',')) {
      const head = item.trim().split(/\s+/)[0]
      if (!head || head === 'none') continue
      if (/^[\d.]/.test(head) || head.startsWith('var(')) continue
      if (/^(ease|linear|steps|cubic-bezier)/.test(head)) continue
      props.push(head)
    }
  }
  return props
}

function isForbidden(prop: string): boolean {
  return (
    LAYOUT.some((p) => prop === p || prop.startsWith(p)) || PAINT.includes(prop)
  )
}

function findViolations(): Set<string> {
  const found = new Set<string>()
  for (const file of styleFiles(SRC)) {
    const rel = relative(ROOT, file)
    for (const prop of transitionedProps(readFileSync(file, 'utf-8')))
      if (isForbidden(prop)) found.add(`${rel}: ${prop}`)
  }
  return found
}

describe('compositor-only アニメーション', () => {
  const found = findViolations()

  it('layout / paint プロパティの transition は ALLOWED 以外に無い', () => {
    const fresh = [...found].filter((k) => !(k in ALLOWED)).sort()
    expect(fresh).toEqual([])
  })

  it('ALLOWED は実在する違反だけを挙げる (直したら消す)', () => {
    const stale = Object.keys(ALLOWED).filter((k) => !found.has(k))
    expect(stale).toEqual([])
  })
})

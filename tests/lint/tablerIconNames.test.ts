// 使っている Tabler アイコン名が、読み込んでいるアイコンフォントに実在するかを検査する (#1215)。
//
// main.ts が読むのは outline 版の tabler-icons.min.css だけで、`-filled` 系は入っていない
// (filled 版の CSS は `.ti` の font-family を上書きするので併用もできない)。存在しない名前を
// 書いてもビルドもテストも通り、画面に何も出ないだけなので、目で気づくまで残り続けていた。
//
// 検査するのは文字列で確実に拾える 2 形だけ:
// - `ti-xxx` と書かれた名前 (クラス文字列 / capability 宣言の icon)
// - `icon: 'xxx'` / `icon="xxx"` のように接頭辞なしで渡す名前 (描画側で `ti-` を付ける)
// `ti-${...}` のように実行時に組み立てる名前は追えないので対象外。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')
const CSS = join(
  ROOT,
  'node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css',
)

function collect(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collect(path, ext)
    return ext.some((e) => entry.name.endsWith(e)) ? [path] : []
  })
}

const known = new Set(
  [...readFileSync(CSS, 'utf8').matchAll(/\.ti-([a-z0-9-]+):before/g)].map(
    (m) => m[1],
  ),
)

// Tabler の名前ではないのに同じ形で書かれているもの
const NOT_ICONS = new Set([
  // timelinePolicy.ts のコメントで、フォーク本家の独自グリフ名として言及している
  'hanamisskey-hanamode',
  // SystemIcon / お知らせの種別 (Tabler の名前ではなく、描画側で絵に引き直す)
  'info',
  'question',
])

// テストはわざと架空の名前 ('ti-a' 等) を渡すので対象外
const files = [
  ...collect(SRC, ['.vue', '.ts', '.tsx', '.json5']).filter(
    (f) => !f.endsWith('.test.ts'),
  ),
  join(ROOT, 'crates/notecore/capabilities.json5'),
]

const PREFIXED = /\bti-([a-z0-9]+(?:-[a-z0-9]+)*)(?![-a-z0-9$])/g
const BARE = /\bicon\s*[:=]\s*['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]/g

function unknownNames(): string[] {
  const out: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const names = new Set<string>()
    for (const m of text.matchAll(PREFIXED)) names.add(m[1] as string)
    for (const m of text.matchAll(BARE)) {
      const name = m[1] as string
      // 'ti-xxx' をそのまま icon に入れている場合は PREFIXED 側で見ている
      if (!name.startsWith('ti-')) names.add(name)
    }
    for (const name of names) {
      if (!known.has(name) && !NOT_ICONS.has(name)) {
        out.push(`${relative(ROOT, file)}: ${name}`)
      }
    }
  }
  return out
}

describe('Tabler アイコン名 (#1215)', () => {
  it('アイコンフォントの CSS から名前を読めている', () => {
    expect(known.size).toBeGreaterThan(1000)
    expect(known.has('player-play')).toBe(true)
  })

  it('使っている名前がすべて読み込んでいるフォントに含まれる', () => {
    expect(unknownNames()).toEqual([])
  })
})

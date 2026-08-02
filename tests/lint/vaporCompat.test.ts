// Vue Vapor モード (#52) の互換性を機械的に維持する。
//
// 互換性チェックは一度やって終わりではなかった: #53 でテンプレート内 $emit() を
// 0 件にしたあと、その後の変更で 1 件混入したまま数ヶ月気づかなかった (#873)。
// CLAUDE.md に禁止事項として書いてあっても、人間の注意力に委ねている限り再発する。
//
// ここで検査するのは「機械的に確実に判定できる」制約だけ。<Transition> /
// <Teleport> は既存コンポーネントに多数あり移行時に個別検証する方針なので対象外。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '../../src')

function collect(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collect(path, ext)
    return ext.some((e) => entry.name.endsWith(e)) ? [path] : []
  })
}

const vueFiles = collect(SRC, ['.vue'])
// テストは Vapor でレンダリングされないので対象外 (h() でスタブを組むのは正当)
const sourceFiles = collect(SRC, ['.vue', '.ts']).filter(
  (f) => !f.endsWith('.test.ts'),
)

/** 違反ファイルを "src/..." 相対パスで返す */
function offenders(files: string[], pattern: RegExp): string[] {
  return files
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => relative(resolve(SRC, '..'), f))
}

describe('Vue Vapor 互換 (#52)', () => {
  it('検査対象の .vue を取りこぼしていない', () => {
    expect(vueFiles.length).toBeGreaterThan(50)
  })

  it('すべての .vue が <script setup>', () => {
    const missing = vueFiles
      .filter((f) => !/<script setup/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(resolve(SRC, '..'), f))
    expect(missing).toEqual([])
  })

  it('テンプレート内 $emit() を使っていない', () => {
    // script setup では $emit を参照できないので、全文検索でテンプレート内だけが引っかかる
    expect(offenders(vueFiles, /\$emit\(/)).toEqual([])
  })

  it('getCurrentInstance() を使っていない', () => {
    expect(offenders(sourceFiles, /\bgetCurrentInstance\s*\(/)).toEqual([])
  })

  it('app.config.globalProperties を使っていない', () => {
    expect(offenders(sourceFiles, /config\.globalProperties/)).toEqual([])
  })

  it('カスタムディレクティブを登録していない', () => {
    expect(offenders(sourceFiles, /\.directive\s*\(/)).toEqual([])
  })

  it('render 関数 / JSX を使っていない', () => {
    expect(collect(SRC, ['.tsx', '.jsx'])).toEqual([])
    // import { h } from 'vue' — 名前付き import の中に h が単独で現れる形だけを見る
    expect(
      offenders(sourceFiles, /import\s*\{[^}]*\bh\b[^}]*\}\s*from\s*'vue'/),
    ).toEqual([])
  })
})

// 「CSS Modules の @keyframes 名はクラス名と衝突させない」を機械検査に落とす (#1083)。
//
// vite.config.ts の `localsConvention: 'camelCaseOnly'` は、クラスだけでなく
// @keyframes の名前も export に載せる。`@keyframes mfm-spin` と `.mfmSpin` は
// どちらもキー `mfmSpin` になり、keyframes の方が後から書かれてクラスを上書きする。
// すると `$style.mfmSpin` はクラス名でなく hash 化された keyframes 名を返し、
// 要素にそのクラスは一度も当たらない。MFM のアニメーションが「ほとんど動かない」
// 真因はこれで、同じ形の衝突が他のコンポーネントにも散っていた。
//
// 衝突しない名前にする (この repo では `kf-` 接頭辞)。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')

const MODULE_STYLESHEET = /\.module\.s?css$/

/** `.vue` と、ファイル全体が CSS Modules の `*.module.(s)css` */
function styleFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...styleFiles(full))
    else if (entry.name.endsWith('.vue') || MODULE_STYLESHEET.test(entry.name))
      out.push(full)
  }
  return out
}

/** `*.module.(s)css` はファイル全体を `<style module>` として検査する */
function asModuleSource(file: string, text: string): string {
  return MODULE_STYLESHEET.test(file)
    ? `<style module>\n${text}\n</style>`
    : text
}

/** postcss-modules と同じ変換 (`foo-bar` → `fooBar`) */
function camelCase(name: string): string {
  return name.replace(/-+(\w)/g, (_, c: string) => c.toUpperCase())
}

const STYLE_MODULE = /<style\b[^>]*\bmodule\b[^>]*>([\s\S]*?)<\/style>/g
const KEYFRAMES = /@keyframes\s+([\w-]+)/g
// セレクタ中のクラス。`:global(.x)` の中身は export されないので外す
const CLASS = /\.([A-Za-z_][\w-]*)/g

function findKeyframeCollisions(
  source: string,
): { keyframes: string; className: string }[] {
  const found: { keyframes: string; className: string }[] = []
  for (const block of source.matchAll(STYLE_MODULE)) {
    // コメントの中の説明文 (`@keyframes x と .y`) を拾わない
    const css = (block[1] ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/:global\([^)]*\)/g, '')
    const classes = new Map<string, string>()
    for (const m of css.matchAll(CLASS)) {
      const name = m[1] ?? ''
      // 数値で始まる疑似 (例: `.5s`) や小数は除く
      if (!/^[A-Za-z_]/.test(name)) continue
      classes.set(camelCase(name), name)
    }
    for (const m of css.matchAll(KEYFRAMES)) {
      const kf = m[1] ?? ''
      const cls = classes.get(camelCase(kf))
      if (cls !== undefined) found.push({ keyframes: kf, className: cls })
    }
  }
  return found
}

describe('CSS Modules の @keyframes 名はクラス名と衝突しない (#1083)', () => {
  it('src の <style module> と *.module.(s)css に衝突が無い', () => {
    const violations: string[] = []
    for (const file of styleFiles(SRC)) {
      const source = asModuleSource(file, readFileSync(file, 'utf8'))
      for (const c of findKeyframeCollisions(source)) {
        violations.push(
          `${relative(ROOT, file)}: @keyframes ${c.keyframes} と .${c.className} が同じキー ${camelCase(c.keyframes)} になる`,
        )
      }
    }
    expect(violations).toEqual([])
  })

  it('検査自体が衝突を見つけられる', () => {
    const src =
      '<style module>\n.spin { animation: spin 1s; }\n@keyframes spin { to { opacity: 0; } }\n</style>'
    expect(findKeyframeCollisions(src)).toEqual([
      { keyframes: 'spin', className: 'spin' },
    ])
    expect(
      findKeyframeCollisions(
        '<style module>\n.mfmSpin { animation: mfm-spin 1s; }\n@keyframes mfm-spin { to { opacity: 0; } }\n</style>',
      ),
    ).toEqual([{ keyframes: 'mfm-spin', className: 'mfmSpin' }])
    expect(
      findKeyframeCollisions(
        '<style module>\n.spin { animation: kf-spin 1s; }\n@keyframes kf-spin { to { opacity: 0; } }\n</style>',
      ),
    ).toEqual([])
    // *.module.(s)css はファイル全体が対象
    expect(
      findKeyframeCollisions(
        asModuleSource(
          'a.module.scss',
          '.slideDown { animation: slide-down 1s; }\n@keyframes slide-down { to { opacity: 0; } }',
        ),
      ),
    ).toEqual([{ keyframes: 'slide-down', className: 'slideDown' }])
    // module でない <style> は対象外
    expect(
      findKeyframeCollisions(
        '<style scoped>\n.spin { animation: spin 1s; }\n@keyframes spin { to { opacity: 0; } }\n</style>',
      ),
    ).toEqual([])
  })
})

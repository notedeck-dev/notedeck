// 文字サイズ・太さ・角丸・余白の直書きを機械検査に落とす (#704 B)。
//
// 0.78em / 11.5px / 600 / 3px のような中途半端な値が画面ごとに散らばると、
// 全体として素人っぽく見える。src/styles/global.css のトークン
// (--nd-font-* / --nd-weight-* / --nd-radius-*) に寄せ、余白は 2px 刻みに揃えた。
// 新しい直書きは落とす。
//
// - font-size: em の直書きは 1em 以外を禁止 (--nd-font-* を使う)。px / rem は
//   固定寸法の部品 (アイコン・IDE 面) 用に許す
// - font-weight: 数値と bold / normal の直書きを禁止 (--nd-weight-*)
// - border-radius: px の直書きを禁止 (0 / 1px / % は許す)
// - padding / margin / gap: 奇数 px を禁止 (1px は罫線合わせで許す)
//
// 方針はラチェット。直しきれない既存分は ALLOWED に "パス: 規則" で凍結する。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')

const DISPLAY = '見出し・アイコン級の表示サイズ (本文の段とは別物)'
const ALLOWED: Record<string, string> = {
  'src/components/DevWelcome.vue: border-radius':
    '開発用のウェルカム画面の装飾',
  'src/components/common/MkChatMessage.vue: border-radius':
    'チャットの吹き出し。カードより丸い形で吹き出しと分かるようにしている',
  'src/components/common/MkEmoji.vue: font-size': DISPLAY,
  'src/components/common/MkMediaGrid.vue: font-size': DISPLAY,
  'src/components/common/MkMfm.vue: font-size':
    'MFM の見出し・$[x2] 等。本家の描画と同じ倍率に合わせる',
  'src/components/deck/ColumnErrorBoundary.vue: font-size': DISPLAY,
  'src/components/deck/DayNightToggle.vue: border-radius':
    '外部素材由来の日夜トグルのイラスト寸法',
  'src/components/deck/DeckAiColumn.vue: border-radius':
    'AI チャットの吹き出し (MkChatMessage と同じ形)',
  'src/components/deck/DeckQueryManagerColumn.vue: font-size': DISPLAY,
  'src/components/window/user-profile/UserProfileHero.vue: border-radius':
    'プロフィールのバナー上のアバター枠',
  'src/components/window/user-profile/UserProfileHero.vue: font-size': DISPLAY,
  'src/views/NotFoundPage.vue: font-size': DISPLAY,
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

/** .vue は <style> の中だけ。トークンの定義行 (--nd-*: ...) は対象外 */
function styleText(file: string): string {
  const src = readFileSync(file, 'utf-8')
  const css = file.endsWith('.vue')
    ? [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
        .map((m) => m[1])
        .join('\n')
    : src
  return css
    .split('\n')
    .filter((l) => !/^\s*--nd-[\w-]+\s*:/.test(l))
    .join('\n')
}

const RULES: Record<string, (css: string) => boolean> = {
  'font-size': (css) =>
    [...css.matchAll(/font-size:\s*([\d.]+)em\b/g)].some((m) => m[1] !== '1'),
  'font-weight': (css) =>
    /font-weight:\s*(bold|normal|bolder|lighter|\d{3})\b/.test(css),
  'border-radius': (css) =>
    [...css.matchAll(/border-radius:\s*([^;{}]+)/g)].some((m) =>
      m[1]
        .replace(/var\([^)]*\)/g, '')
        .split(/\s+/)
        .some((v) => /^\d*\.?\d+px$/.test(v) && v !== '1px'),
    ),
  spacing: (css) =>
    [
      ...css.matchAll(
        /\b(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?\s*:\s*([^;{}]+)/g,
      ),
    ].some((m) =>
      [...m[1].matchAll(/(?<![\w.-])(\d+)px\b/g)].some(
        (v) => Number(v[1]) % 2 === 1 && v[1] !== '1',
      ),
    ),
}

function findViolations(): Set<string> {
  const found = new Set<string>()
  for (const file of styleFiles(SRC)) {
    const rel = relative(ROOT, file)
    const css = styleText(file)
    for (const [name, broken] of Object.entries(RULES))
      if (broken(css)) found.add(`${rel}: ${name}`)
  }
  return found
}

describe('デザイントークン', () => {
  const found = findViolations()

  it('文字サイズ・太さ・角丸・余白の直書きは ALLOWED 以外に無い', () => {
    const fresh = [...found].filter((k) => !(k in ALLOWED)).sort()
    expect(fresh).toEqual([])
  })

  it('ALLOWED は実在する違反だけを挙げる (直したら消す)', () => {
    const stale = Object.keys(ALLOWED).filter((k) => !found.has(k))
    expect(stale).toEqual([])
  })
})

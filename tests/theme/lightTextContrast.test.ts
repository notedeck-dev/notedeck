// 組込ライトテーマの「文字として読む色」が WCAG AA (4.5:1) を満たすことを固定する (#1213)。
//
// 文字色だけを濃くし、塗りに使う accent は本家の色のまま残す方針。
// 文字の accent は塗りの accent と分けて --nd-accentText で引く。

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIGHT_BASE, MI_LIGHT } from '@/theme/builtinThemes'
import { parseColor } from '@/theme/colorUtils'
import { compileMisskeyTheme } from '@/theme/compiler'

function luminance(value: string): number {
  const rgba = parseColor(value)
  if (!rgba) throw new Error(`色として読めない: ${value}`)
  const [r, g, b] = rgba.slice(0, 3).map((c) => {
    const x = c / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

describe('Mi Light の文字色のコントラスト (#1213)', () => {
  const compiled = compileMisskeyTheme(MI_LIGHT, LIGHT_BASE)
  const TEXT = ['link', 'hashtag', 'mention', 'mentionMe', 'accentText']
  const SURFACES = ['bg', 'panel', 'popup']

  for (const text of TEXT) {
    for (const surface of SURFACES) {
      it(`${text} は ${surface} に対して 4.5:1 以上`, () => {
        expect(
          contrast(compiled[text] ?? '', compiled[surface] ?? ''),
        ).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('塗りに使う accent は本家の色のまま', () => {
    expect(parseColor(compiled.accent ?? '')).toEqual(parseColor('#86b300'))
  })
})

describe('文字の accent は --nd-accentText で引く (#1213)', () => {
  const SRC = resolve(import.meta.dirname, '../../src')
  function styleFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name)
      if (e.isDirectory()) return styleFiles(path)
      return /\.(vue|css|scss)$/.test(e.name) ? [path] : []
    })
  }

  it('color: var(--nd-accent) を直接使わない', () => {
    const offenders = styleFiles(SRC).filter((file) =>
      /(^|[^-\w])color:\s*var\(--nd-accent\)/m.test(
        readFileSync(file, 'utf-8'),
      ),
    )
    expect(offenders).toEqual([])
  })
})

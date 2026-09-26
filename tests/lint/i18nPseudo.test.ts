// 疑似ロケール (#135)。英語化での崩れ (はみ出し・切り詰め・直書き) を目で
// 見つけるため、英語の文を伸ばして括弧で囲んだ言語を開発者モードで選べるようにする

import { describe, expect, it } from 'vitest'
import {
  compose,
  FALLBACK_LANG,
  flatten,
  pseudoize,
} from '../../scripts/gen-i18n.ts'

describe('疑似ロケール (#135)', () => {
  it('文を 1.4 倍程度に伸ばし、端が見えるよう括弧で囲む', () => {
    const out = pseudoize('Save')
    expect(out.startsWith('[')).toBe(true)
    expect(out.endsWith(']')).toBe(true)
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil('Save'.length * 1.4))
    expect(out).not.toContain('Save')
  })

  it('param はそのまま残す', () => {
    expect(pseudoize('{count} notes by {name}')).toMatch(
      /^\[\{count\} .*\{name\}.*\]$/,
    )
  })

  it('辞書は英語のキーをすべて持ち、param の並びも変えない', () => {
    const en = flatten(compose(FALLBACK_LANG))
    const pseudo = flatten(compose('en-XA'))
    expect([...pseudo.keys()]).toEqual([...en.keys()])
    const params = (leaf: unknown) =>
      JSON.stringify(leaf)
        .match(/\{\w+\}/g)
        ?.sort() ?? []
    for (const [key, leaf] of en)
      expect(params(pseudo.get(key)), key).toEqual(params(leaf))
  })
})

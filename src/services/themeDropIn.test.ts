import { describe, expect, it } from 'vitest'
import {
  isDropInCandidate,
  nextDropInId,
  parseDropInRecord,
  parseDropInTheme,
  pickPendingDropIns,
  pruneDropInRecord,
  serializeDropInRecord,
} from './themeDropIn'

describe('themeDropIn: 候補判定 (#1041)', () => {
  it('素の .json5 だけを候補にし、既知の複合拡張子は除く', () => {
    expect(isDropInCandidate('community.json5')).toBe(true)
    expect(isDropInCandidate('mine.ndtheme.json5')).toBe(false)
    expect(isDropInCandidate('mine.ndtheme.history.json5')).toBe(false)
    expect(isDropInCandidate('mine.history.json5')).toBe(false)
    expect(isDropInCandidate('mine.meta.json5')).toBe(false)
    expect(isDropInCandidate('p.ndprofile.json5')).toBe(false)
    expect(isDropInCandidate('readme.md')).toBe(false)
    expect(isDropInCandidate('.json5')).toBe(false)
  })

  it('採用記録に無い候補だけを返す (ファイル名は大小を区別しない)', () => {
    const files = ['A.json5', 'b.json5', 'c.ndtheme.json5', 'd.json5']
    const record = { 'a.json5': 'custom-1' }
    expect(pickPendingDropIns(files, record)).toEqual(['b.json5', 'd.json5'])
  })

  it('元ファイルが消えた記録は落とす (再 drop したら採用し直す)', () => {
    const record = { 'gone.json5': 'custom-1', 'stay.json5': 'custom-2' }
    expect(pruneDropInRecord(record, ['stay.json5'])).toEqual({
      'stay.json5': 'custom-2',
    })
  })
})

describe('themeDropIn: テーマ解釈', () => {
  it('props を持つオブジェクトをテーマとして解釈し、名前が無ければファイル名の幹を使う', () => {
    const t = parseDropInTheme('{ props: { bg: "#000" } }', 'Cool Theme.json5')
    expect(t).toEqual({
      name: 'Cool Theme',
      base: 'dark',
      props: { bg: '#000' },
    })
  })

  it('Misskey コミュニティテーマの name / base を引き継ぐ', () => {
    const raw = `{
      id: "abc", name: "Sakura", author: "x", desc: "y", base: "light",
      props: { bg: "#fff", fg: "#000" },
    }`
    expect(parseDropInTheme(raw, 'sakura.json5')).toEqual({
      name: 'Sakura',
      base: 'light',
      props: { bg: '#fff', fg: '#000' },
    })
  })

  it('元ファイルの $notedeck (ストア紐付き / per-account 紐付き) は引き継がない', () => {
    const raw = '{ name: "n", props: { a: "b" }, $notedeck: { storeId: "s" } }'
    expect(parseDropInTheme(raw, 'n.json5')).not.toHaveProperty('$notedeck')
  })

  it('テーマでないもの (props 欠落・配列・壊れた JSON5) は null', () => {
    expect(parseDropInTheme('{ name: "x" }', 'x.json5')).toBeNull()
    expect(parseDropInTheme('{ props: "str" }', 'x.json5')).toBeNull()
    expect(parseDropInTheme('[1, 2]', 'x.json5')).toBeNull()
    expect(parseDropInTheme('{ broken', 'x.json5')).toBeNull()
  })
})

describe('themeDropIn: ID と記録', () => {
  it('新しい ID を採番し、既存と衝突したら suffix を付ける', () => {
    expect(nextDropInId(new Set(), 100)).toBe('custom-100')
    expect(nextDropInId(new Set(['custom-100']), 100)).toBe('custom-100-2')
    expect(nextDropInId(new Set(['custom-100', 'custom-100-2']), 100)).toBe(
      'custom-100-3',
    )
  })

  it('記録は JSON5 で往復し、壊れていれば空扱い', () => {
    const record = { 'a.json5': 'custom-1' }
    expect(parseDropInRecord(serializeDropInRecord(record))).toEqual(record)
    expect(parseDropInRecord('')).toEqual({})
    expect(parseDropInRecord('{ broken')).toEqual({})
    expect(parseDropInRecord('{ adopted: [1] }')).toEqual({})
    expect(parseDropInRecord('{ adopted: { "a.json5": 1 } }')).toEqual({})
  })
})

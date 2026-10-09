import { describe, expect, it } from 'vitest'
import { emojilist } from '@/data/emojilist'
import enIndex from '@/data/unicode-emoji-indexes/en-US.json'
import jaIndex from '@/data/unicode-emoji-indexes/ja-JP.json'
import jaHiraIndex from '@/data/unicode-emoji-indexes/ja-JP_hira.json'
import { searchUnicodeEmojis } from '@/services/emojiSearch'

const chars = (q: string, indexes: Record<string, string[]>[] = []) =>
  searchUnicodeEmojis(q, emojilist, indexes).map((e) => e.char)

describe('searchUnicodeEmojis (#1193)', () => {
  it('空の検索語は何も返さない', () => {
    expect(chars('')).toEqual([])
    expect(chars('   ')).toEqual([])
  })

  it('英名の完全一致を先頭に出す', () => {
    expect(chars('cat')[0]).toBe('🐱')
    expect(chars('+1')[0]).toBe('👍')
  })

  it('前方一致は部分一致より先に並ぶ', () => {
    const result = chars('smile')
    expect(result[0]).toBe('😄')
    const prefix = result.indexOf('😸') // smile_cat
    const partial = result.indexOf('😅') // sweat_smile
    expect(prefix).toBeGreaterThanOrEqual(0)
    expect(partial).toBeGreaterThan(prefix)
  })

  it('コロンと大文字小文字を無視する', () => {
    expect(chars(':Cat:')[0]).toBe('🐱')
  })

  it('空白区切りは AND 検索になる', () => {
    const result = chars('cat face')
    expect(result.length).toBeGreaterThan(0)
    for (const c of result) {
      const name = emojilist.find((e) => e.char === c)?.name ?? ''
      expect(name).toContain('cat')
      expect(name).toContain('face')
    }
  })

  it('キーワード辞書を引く (日本語)', () => {
    expect(chars('サムズアップ', [jaIndex])).toContain('👍')
    expect(chars('ねこ', [jaHiraIndex])).toContain('🐱')
  })

  it('キーワード辞書を引く (英語)', () => {
    expect(chars('thumbsup', [enIndex])).toContain('👍')
  })

  it('辞書を渡さなければ英名だけで引く', () => {
    expect(chars('サムズアップ')).toEqual([])
  })

  it('辞書の AND 検索はすべての語がどれかのキーワードに含まれるものだけ', () => {
    const result = chars('ねこ かお', [jaHiraIndex])
    expect(result).toContain('🐱')
    for (const c of result) {
      const kw = (jaHiraIndex as Record<string, string[]>)[c] ?? []
      expect(kw.some((k) => k.includes('ねこ'))).toBe(true)
      expect(kw.some((k) => k.includes('かお'))).toBe(true)
    }
  })

  it('同じ絵文字を重複して返さない', () => {
    const result = chars('cat', [{ '🐱': ['cat'] }])
    expect(new Set(result).size).toBe(result.length)
  })

  it('件数の上限で打ち切る', () => {
    expect(searchUnicodeEmojis('a', emojilist, [], 10)).toHaveLength(10)
  })
})

import { describe, expect, it } from 'vitest'
import { extractUrlFromMfm } from './extractUrlFromMfm'
import { parseTokens } from './mfmParser'

describe('extractUrlFromMfm', () => {
  describe('基本', () => {
    it('空配列を渡すと空配列を返す', () => {
      expect(extractUrlFromMfm([])).toEqual([])
    })

    it('プレーンテキストだけのトークンでは URL を抽出しない', () => {
      expect(
        extractUrlFromMfm(parseTokens('これはただのテキストです')),
      ).toEqual([])
    })

    it('ハッシュタグやメンションは抽出対象に含めない', () => {
      const tokens = parseTokens('#タグ @user@example.com これはテキスト')
      expect(extractUrlFromMfm(tokens)).toEqual([])
    })
  })

  describe('url トークン', () => {
    it('bare URL を 1 件抽出できる', () => {
      const tokens = parseTokens('見てね https://example.com ね')
      expect(extractUrlFromMfm(tokens)).toEqual(['https://example.com'])
    })

    it('複数の bare URL を順序を保って抽出できる', () => {
      const tokens = parseTokens(
        'まず https://a.example と次に https://b.example',
      )
      expect(extractUrlFromMfm(tokens)).toEqual([
        'https://a.example',
        'https://b.example',
      ])
    })
  })

  describe('link トークン', () => {
    it('MFM link 記法の URL を抽出できる', () => {
      const tokens = parseTokens('[公式サイト](https://example.com)')
      expect(extractUrlFromMfm(tokens)).toEqual(['https://example.com'])
    })

    it('silent link (?[...]()) は既定で除外される', () => {
      const tokens = parseTokens('?[内緒](https://secret.example)')
      expect(extractUrlFromMfm(tokens)).toEqual([])
    })

    it('respectSilentFlag=false では silent link も抽出する', () => {
      const tokens = parseTokens('?[内緒](https://secret.example)')
      expect(extractUrlFromMfm(tokens, false)).toEqual([
        'https://secret.example',
      ])
    })

    it('link の label 内に含まれる url トークンも再帰的に抽出する', () => {
      const tokens = parseTokens(
        '[https://inner.example を見る](https://outer.example)',
      )
      expect(extractUrlFromMfm(tokens)).toEqual([
        'https://outer.example',
        'https://inner.example',
      ])
    })
  })

  describe('重複排除', () => {
    it('完全一致の重複は 1 件にまとめる', () => {
      const tokens = parseTokens(
        'https://example.com もう一度 https://example.com',
      )
      expect(extractUrlFromMfm(tokens)).toEqual(['https://example.com'])
    })

    it('ハッシュ (#...) だけ異なる URL は先頭のみ残す', () => {
      const tokens = parseTokens(
        'https://example.com/page#a と https://example.com/page#b',
      )
      expect(extractUrlFromMfm(tokens)).toEqual(['https://example.com/page#a'])
    })

    it('ハッシュの有無が混在しても先頭のものだけ残す', () => {
      const tokens = parseTokens(
        'https://example.com/page と https://example.com/page#section',
      )
      expect(extractUrlFromMfm(tokens)).toEqual(['https://example.com/page'])
    })
  })

  describe('ネストされた構造', () => {
    it('bold の中の URL を抽出できる', () => {
      const tokens = parseTokens('**https://bold.example**')
      expect(extractUrlFromMfm(tokens)).toEqual(['https://bold.example'])
    })

    it('quote の中の URL を抽出できる', () => {
      const tokens = parseTokens('> 引用内 https://quote.example\n')
      expect(extractUrlFromMfm(tokens)).toEqual(['https://quote.example'])
    })

    it('fn (MFM 関数) の中の URL を抽出できる', () => {
      const tokens = parseTokens('$[x2 https://fn.example]')
      expect(extractUrlFromMfm(tokens)).toEqual(['https://fn.example'])
    })

    it('small / center タグ内の URL を抽出できる', () => {
      const tokens = parseTokens('<small>https://small.example</small>')
      expect(extractUrlFromMfm(tokens)).toEqual(['https://small.example'])
    })
  })
})

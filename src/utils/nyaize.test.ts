import { describe, expect, it } from 'vitest'
import type { MfmToken } from './mfmParser'
import { nyaize, nyaizeTokens } from './nyaize'

describe('nyaize', () => {
  it('日本語の な / ナ / ﾅ を にゃ化する', () => {
    expect(nyaize('なんと')).toBe('にゃんと')
    expect(nyaize('ナナ')).toBe('ニャニャ')
    expect(nyaize('ﾅﾝﾃﾞ')).toBe('ﾆｬﾝﾃﾞ')
  })

  it('英語の na / morning / everyone を変換する', () => {
    expect(nyaize('banana')).toBe('banyanya')
    expect(nyaize('good morning')).toBe('good mornyan')
    expect(nyaize('everyone')).toBe('everynyan')
    expect(nyaize('BANANA')).toBe('BANYANYA')
  })

  it('韓国語の 나 行 / 語尾 다 / 야 を変換する', () => {
    expect(nyaize('나')).toBe('냐')
    expect(nyaize('합니다.')).toBe('합니다냥.')
    expect(nyaize('뭐야?')).toBe('뭐냥?')
  })

  it('対象文字を含まないテキストはそのまま返す', () => {
    expect(nyaize('hello world')).toBe('hello world')
  })
})

describe('nyaizeTokens', () => {
  it('text ノードの値を にゃ化する', () => {
    const tokens: MfmToken[] = [{ type: 'text', value: 'なんと' }]
    expect(nyaizeTokens(tokens)).toEqual([{ type: 'text', value: 'にゃんと' }])
  })

  it('URL / コード / メンション / カスタム絵文字 / plain は変換しない', () => {
    const tokens: MfmToken[] = [
      { type: 'url', value: 'https://nano.example/' },
      { type: 'inlineCode', value: 'なんと' },
      { type: 'codeBlock', lang: null, value: 'なんと' },
      { type: 'mention', username: 'nana', host: null, acct: '@nana' },
      { type: 'customEmoji', shortcode: 'nande' },
      { type: 'plain', value: 'なんと' },
    ]
    expect(nyaizeTokens(tokens)).toEqual(tokens)
  })

  it('bold / fn などの子ノード内の text も変換する', () => {
    const tokens: MfmToken[] = [
      { type: 'bold', children: [{ type: 'text', value: 'な' }] },
      {
        type: 'fn',
        name: 'shake',
        args: {},
        children: [{ type: 'text', value: 'ナ' }],
      },
    ]
    expect(nyaizeTokens(tokens)).toEqual([
      { type: 'bold', children: [{ type: 'text', value: 'にゃ' }] },
      {
        type: 'fn',
        name: 'shake',
        args: {},
        children: [{ type: 'text', value: 'ニャ' }],
      },
    ])
  })

  it('入力のトークンツリーを破壊しない (parseMfm キャッシュ保護)', () => {
    const child: MfmToken = { type: 'text', value: 'な' }
    const tokens: MfmToken[] = [{ type: 'bold', children: [child] }]
    nyaizeTokens(tokens)
    expect(child.value).toBe('な')
  })
})

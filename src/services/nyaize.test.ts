import type { MfmText } from 'mfm-js'
import { describe, expect, it } from 'vitest'
import type { MfmNode } from './mfmParser'
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

const text = (value: string): MfmText => ({
  type: 'text',
  props: { text: value },
})

describe('nyaizeTokens', () => {
  it('text ノードの値を にゃ化する', () => {
    expect(nyaizeTokens([text('なんと')])).toEqual([text('にゃんと')])
  })

  it('URL / コード / メンション / カスタム絵文字 / plain は変換しない', () => {
    const nodes: MfmNode[] = [
      { type: 'url', props: { url: 'https://nano.example/' } },
      { type: 'inlineCode', props: { code: 'なんと' } },
      { type: 'blockCode', props: { code: 'なんと', lang: null } },
      {
        type: 'mention',
        props: { username: 'nana', host: null, acct: '@nana' },
      },
      { type: 'emojiCode', props: { name: 'nande' } },
      {
        type: 'plain',
        children: [{ type: 'text', props: { text: 'なんと' } }],
      },
    ]
    expect(nyaizeTokens(nodes)).toEqual(nodes)
  })

  it('bold / fn / link / heading / list の子ノード内の text も変換する', () => {
    const nodes: MfmNode[] = [
      { type: 'bold', children: [{ type: 'text', props: { text: 'な' } }] },
      {
        type: 'fn',
        props: { name: 'shake', args: {} },
        children: [{ type: 'text', props: { text: 'ナ' } }],
      },
      {
        type: 'link',
        props: { silent: false, url: 'https://example.com' },
        children: [{ type: 'text', props: { text: 'な' } }],
      },
      {
        type: 'heading',
        props: { level: 1 },
        children: [text('な')],
      },
      { type: 'list', props: { ordered: false, items: [[text('な')]] } },
    ]
    expect(nyaizeTokens(nodes)).toEqual([
      { type: 'bold', children: [{ type: 'text', props: { text: 'にゃ' } }] },
      {
        type: 'fn',
        props: { name: 'shake', args: {} },
        children: [{ type: 'text', props: { text: 'ニャ' } }],
      },
      {
        type: 'link',
        props: { silent: false, url: 'https://example.com' },
        children: [{ type: 'text', props: { text: 'にゃ' } }],
      },
      {
        type: 'heading',
        props: { level: 1 },
        children: [text('にゃ')],
      },
      { type: 'list', props: { ordered: false, items: [[text('にゃ')]] } },
    ])
  })

  it('入力のノードツリーを破壊しない (parseMfm キャッシュ保護)', () => {
    const child = { type: 'text', props: { text: 'な' } } as const
    const nodes: MfmNode[] = [{ type: 'bold', children: [child] }]
    nyaizeTokens(nodes)
    expect(child.props.text).toBe('な')
  })
})

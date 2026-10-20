import { describe, expect, it } from 'vitest'
import { type MfmNode, parseTokens } from '@/services/mfmParser'

const text = (value: string): MfmNode => ({
  type: 'text',
  props: { text: value },
})

describe('parseTokens (mfm-js)', () => {
  it('空文字は空配列', () => {
    expect(parseTokens('')).toEqual([])
  })

  it('素のテキストは text ノード 1 つ', () => {
    expect(parseTokens('hello world')).toEqual([text('hello world')])
  })

  // 以下は mfm-js (本家と同じ) に委ねている挙動の契約。旧自前パーサから変わった点を
  // 記録しておく
  it('bare URL は日本語の手前で止まる (#307)', () => {
    expect(parseTokens('https://ja.wikipedia.org/wiki/シナモン')).toEqual([
      { type: 'url', props: { url: 'https://ja.wikipedia.org/wiki/' } },
      text('シナモン'),
    ])
  })

  it('入れ子の深さは mfm-js の nestLimit で止まる', () => {
    const nodes = parseTokens(`${'$[x2 '.repeat(30)}a${']'.repeat(30)}`)
    let depth = 0
    let cur: MfmNode[] = nodes
    while (cur[0]?.type === 'fn') {
      depth++
      cur = cur[0].children
    }
    expect(depth).toBeLessThan(30)
  })

  it('***big*** は本家と同じく $[tada] になる', () => {
    expect(parseTokens('***big***')).toEqual([
      {
        type: 'fn',
        props: { name: 'tada', args: {} },
        children: [text('big')],
      },
    ])
  })

  it('`>` の後にスペースが無くても quote になる (本家と同じ)', () => {
    expect(parseTokens('>no space')).toEqual([
      { type: 'quote', children: [text('no space')] },
    ])
  })

  it(':name@host: は emojiCode ではなく text (本家と同じ。リアクションは MkMfm を通らない)', () => {
    expect(parseTokens(':emoji@remote.host:')).toEqual([
      text(':emoji@remote.host:'),
    ])
  })

  it('`[label](memo:<id>)` は markdown 無しでは text のまま', () => {
    expect(parseTokens('[a](memo:20260101000000)')).toEqual([
      text('[a](memo:20260101000000)'),
    ])
  })
})

describe('parseTokens memo 向け拡張 (markdown: true)', () => {
  const parse = (s: string) => parseTokens(s, { markdown: true })

  it('ATX heading を level 付きの heading ノードにする', () => {
    expect(parse('# 見出し')).toEqual([
      { type: 'heading', props: { level: 1 }, children: [text('見出し')] },
    ])
    expect(parse('###### 六')).toEqual([
      { type: 'heading', props: { level: 6 }, children: [text('六')] },
    ])
  })

  it('heading の中身は MFM として解釈する', () => {
    expect(parse('## **太字** :emoji:')).toEqual([
      {
        type: 'heading',
        props: { level: 2 },
        children: [
          { type: 'bold', children: [text('太字')] },
          text(' '),
          { type: 'emojiCode', props: { name: 'emoji' } },
        ],
      },
    ])
  })

  it('`#tag` (スペース無し) は heading ではなく hashtag', () => {
    expect(parse('#tag')).toEqual([
      { type: 'hashtag', props: { hashtag: 'tag' } },
    ])
  })

  it('行頭でない `# ` は heading にしない', () => {
    expect(parse('a # b')).toEqual([text('a # b')])
  })

  it('heading の前後のテキストは別ノードになる', () => {
    expect(parse('before\n# h\nafter')).toEqual([
      text('before'),
      { type: 'heading', props: { level: 1 }, children: [text('h')] },
      text('after'),
    ])
  })

  it('`- ` の連続行を unordered list にする', () => {
    expect(parse('- a\n- b')).toEqual([
      {
        type: 'list',
        props: { ordered: false, items: [[text('a')], [text('b')]] },
      },
    ])
  })

  it('`1. ` の連続行を ordered list にする (番号は問わない)', () => {
    expect(parse('1. a\n7. b')).toEqual([
      {
        type: 'list',
        props: { ordered: true, items: [[text('a')], [text('b')]] },
      },
    ])
  })

  it('unordered の記号 (`-` / `*`) が変わると別の list になる', () => {
    expect(parse('- a\n* b')).toEqual([
      { type: 'list', props: { ordered: false, items: [[text('a')]] } },
      { type: 'list', props: { ordered: false, items: [[text('b')]] } },
    ])
  })

  it('list の項目の中身は MFM として解釈する', () => {
    expect(parse('- $[spin a]')).toEqual([
      {
        type: 'list',
        props: {
          ordered: false,
          items: [
            [
              {
                type: 'fn',
                props: { name: 'spin', args: {} },
                children: [text('a')],
              },
            ],
          ],
        },
      },
    ])
  })

  it('コードブロックの中の `# ` / `- ` は heading / list にしない', () => {
    expect(parse('```sh\n# comment\n- not list\n```')).toEqual([
      {
        type: 'blockCode',
        props: { code: '# comment\n- not list', lang: 'sh' },
      },
    ])
  })

  it('quote の中の heading は heading にしない (quote は mfm-js に任せる)', () => {
    expect(parse('> # a')).toEqual([{ type: 'quote', children: [text('# a')] }])
  })

  it('`[label](memo:<id>)` を url が memo: の link にする (#494)', () => {
    expect(parse('[メモ](memo:20260101000000)')).toEqual([
      {
        type: 'link',
        props: { silent: false, url: 'memo:20260101000000' },
        children: [text('メモ')],
      },
    ])
  })

  it('memo リンクのラベルに絵文字や装飾があっても link になる', () => {
    expect(parse('[:e: **t**](memo:20260101000000)')).toEqual([
      {
        type: 'link',
        props: { silent: false, url: 'memo:20260101000000' },
        children: [
          { type: 'emojiCode', props: { name: 'e' } },
          text(' '),
          { type: 'bold', children: [text('t')] },
        ],
      },
    ])
  })

  it('memo リンクは $[fn] や heading の中でも link になる', () => {
    expect(parse('# $[x2 [a](memo:20260101000000)]')).toEqual([
      {
        type: 'heading',
        props: { level: 1 },
        children: [
          {
            type: 'fn',
            props: { name: 'x2', args: {} },
            children: [
              {
                type: 'link',
                props: { silent: false, url: 'memo:20260101000000' },
                children: [text('a')],
              },
            ],
          },
        ],
      },
    ])
  })

  it('14 桁でない memo: はリンクにしない', () => {
    expect(parse('[a](memo:1234)')).toEqual([text('[a](memo:1234)')])
  })

  it('インラインコード / コードブロックの中の memo リンク記法は原文のまま', () => {
    expect(parse('`[a](memo:20260101000000)`')).toEqual([
      { type: 'inlineCode', props: { code: '[a](memo:20260101000000)' } },
    ])
    expect(parse('```\n[a](memo:20260101000000)\n```')).toEqual([
      {
        type: 'blockCode',
        props: { code: '[a](memo:20260101000000)', lang: null },
      },
    ])
  })

  it('普通の https リンクはそのまま', () => {
    expect(parse('[a](https://example.com)')).toEqual([
      {
        type: 'link',
        props: { silent: false, url: 'https://example.com' },
        children: [text('a')],
      },
    ])
  })
})

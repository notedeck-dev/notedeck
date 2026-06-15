import { describe, expect, it } from 'vitest'
import { type MfmToken, parseTokens as parseMfm } from '@/utils/mfmParser'

describe('parseMfm', () => {
  it('returns empty array for empty string', () => {
    expect(parseMfm('')).toEqual([])
  })

  it('returns single text token for plain text', () => {
    const tokens = parseMfm('hello world')
    expect(tokens).toEqual([{ type: 'text', value: 'hello world' }])
  })

  // URL
  it('parses URLs', () => {
    const tokens = parseMfm('visit https://example.com today')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'text', value: 'visit ' })
    expect(tokens[1]).toEqual({ type: 'url', value: 'https://example.com' })
    expect(tokens[2]).toEqual({ type: 'text', value: ' today' })
  })

  it('parses URL with path and query', () => {
    const tokens = parseMfm('https://example.com/path?q=1&b=2#hash')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('url')
  })

  it('bare URL stops before Japanese characters (mfm-js compat, #307)', () => {
    const tokens = parseMfm('https://ja.wikipedia.org/wiki/シナモン')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({
      type: 'url',
      value: 'https://ja.wikipedia.org/wiki/',
    })
  })

  it('does not include trailing Japanese text as part of URL (#307)', () => {
    const tokens = parseMfm('https://example.comあ')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({ type: 'url', value: 'https://example.com' })
    expect(tokens[1]).toEqual({ type: 'text', value: 'あ' })
  })

  it('does not include trailing Japanese after path as part of URL (#307)', () => {
    const tokens = parseMfm('https://ja.wikipedia.org/wiki/hogeあ')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({
      type: 'url',
      value: 'https://ja.wikipedia.org/wiki/hoge',
    })
    expect(tokens[1]).toEqual({ type: 'text', value: 'あ' })
  })

  it('parses percent-encoded non-ASCII URL correctly', () => {
    const tokens = parseMfm(
      'https://ja.wikipedia.org/wiki/%E3%82%B7%E3%83%8A%E3%83%A2%E3%83%B3',
    )
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({
      type: 'url',
      value:
        'https://ja.wikipedia.org/wiki/%E3%82%B7%E3%83%8A%E3%83%A2%E3%83%B3',
    })
  })

  // Mentions
  it('parses local mention', () => {
    const tokens = parseMfm('hello @user')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({ type: 'text', value: 'hello ' })
    expect(tokens[1]).toEqual({
      type: 'mention',
      username: 'user',
      host: null,
      acct: '@user',
    })
  })

  it('parses remote mention', () => {
    const tokens = parseMfm('@user@example.com hi')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({
      type: 'mention',
      username: 'user',
      host: 'example.com',
      acct: '@user@example.com',
    })
    expect(tokens[1]).toEqual({ type: 'text', value: ' hi' })
  })

  it('does not parse mention inside word', () => {
    const tokens = parseMfm('email@example.com')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('text')
  })

  // Hashtags
  it('parses hashtag', () => {
    const tokens = parseMfm('check #Misskey')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({ type: 'text', value: 'check ' })
    expect(tokens[1]).toEqual({ type: 'hashtag', value: 'Misskey' })
  })

  it('parses Japanese hashtag', () => {
    const tokens = parseMfm('#日本語タグ test')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toEqual({ type: 'hashtag', value: '日本語タグ' })
    expect(tokens[1]).toEqual({ type: 'text', value: ' test' })
  })

  // Bold
  it('parses bold **text**', () => {
    const tokens = parseMfm('this is **bold** text')
    expect(tokens).toHaveLength(3)
    expect(tokens[1]).toEqual({
      type: 'bold',
      children: [{ type: 'text', value: 'bold' }],
    })
  })

  it('parses bold __text__', () => {
    const tokens = parseMfm('this is __bold__ text')
    expect(tokens).toHaveLength(3)
    expect(tokens[1]).toEqual({
      type: 'bold',
      children: [{ type: 'text', value: 'bold' }],
    })
  })

  it('parses <b> tag', () => {
    const tokens = parseMfm('<b>bold</b>')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({
      type: 'bold',
      children: [{ type: 'text', value: 'bold' }],
    })
  })

  // Italic
  it('parses italic *text*', () => {
    const tokens = parseMfm('this is *italic* text')
    expect(tokens).toHaveLength(3)
    expect(tokens[1]).toEqual({
      type: 'italic',
      children: [{ type: 'text', value: 'italic' }],
    })
  })

  it('parses italic _text_', () => {
    const tokens = parseMfm('this is _italic_ text')
    expect(tokens).toHaveLength(3)
    expect(tokens[1]).toEqual({
      type: 'italic',
      children: [{ type: 'text', value: 'italic' }],
    })
  })

  it('parses <i> tag', () => {
    const tokens = parseMfm('<i>italic</i>')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({
      type: 'italic',
      children: [{ type: 'text', value: 'italic' }],
    })
  })

  it('does not confuse bold with italic', () => {
    const tokens = parseMfm('**bold** and *italic*')
    const bold = tokens.find(
      (t): t is MfmToken & { type: 'bold' } => t.type === 'bold',
    )
    const italic = tokens.find(
      (t): t is MfmToken & { type: 'italic' } => t.type === 'italic',
    )
    expect(bold?.children).toEqual([{ type: 'text', value: 'bold' }])
    expect(italic?.children).toEqual([{ type: 'text', value: 'italic' }])
  })

  // Big (***text***)
  it('parses ***big*** as bold + italic', () => {
    const tokens = parseMfm('***big!***')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({
      type: 'bold',
      children: [
        {
          type: 'italic',
          children: [{ type: 'text', value: 'big!' }],
        },
      ],
    })
  })

  // Strikethrough
  it('parses strikethrough ~~text~~', () => {
    const tokens = parseMfm('this is ~~deleted~~ text')
    expect(tokens).toHaveLength(3)
    expect(tokens[1]).toEqual({
      type: 'strike',
      children: [{ type: 'text', value: 'deleted' }],
    })
  })

  it('parses <s> tag', () => {
    const tokens = parseMfm('<s>strike</s>')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({
      type: 'strike',
      children: [{ type: 'text', value: 'strike' }],
    })
  })

  // Inline code
  it('parses inline code', () => {
    const tokens = parseMfm('use `console.log()` here')
    expect(tokens).toHaveLength(3)
    expect(tokens[1]).toEqual({ type: 'inlineCode', value: 'console.log()' })
  })

  it('inline code takes priority over other patterns', () => {
    const tokens = parseMfm('`**not bold**`')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({ type: 'inlineCode', value: '**not bold**' })
  })

  // Custom emoji
  it('parses custom emoji', () => {
    const tokens = parseMfm('hello :blobcat: world')
    expect(tokens).toHaveLength(3)
    expect(tokens[1]).toEqual({ type: 'customEmoji', shortcode: 'blobcat' })
  })

  it('parses remote custom emoji', () => {
    const tokens = parseMfm(':emoji@remote.host:')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({
      type: 'customEmoji',
      shortcode: 'emoji@remote.host',
    })
  })

  it('strips @. suffix from local custom emoji', () => {
    const tokens = parseMfm(':hoge@.:')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({ type: 'customEmoji', shortcode: 'hoge' })
  })

  // Unicode emoji
  it('parses unicode emoji', () => {
    const tokens = parseMfm('hello 😀 world')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'text', value: 'hello ' })
    expect(tokens[1]?.type).toBe('unicodeEmoji')
    expect((tokens[1] as { type: 'unicodeEmoji'; value: string }).value).toBe(
      '😀',
    )
    expect(tokens[2]).toEqual({ type: 'text', value: ' world' })
  })

  // Mixed
  it('parses mixed content', () => {
    const tokens = parseMfm('**bold** @user https://example.com :emoji: #tag')
    const types = tokens.map((t) => t.type)
    expect(types).toContain('bold')
    expect(types).toContain('mention')
    expect(types).toContain('url')
    expect(types).toContain('customEmoji')
    expect(types).toContain('hashtag')
  })

  // URL takes priority over patterns inside it
  it('URL is not broken by custom emoji-like patterns', () => {
    const tokens = parseMfm('https://example.com/path')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('url')
  })

  // Markdown link
  it('parses markdown link', () => {
    const tokens = parseMfm('click [here](https://example.com) now')
    expect(tokens).toHaveLength(3)
    expect(tokens[1]).toEqual({
      type: 'link',
      label: [{ type: 'text', value: 'here' }],
      url: 'https://example.com',
      silent: false,
    })
  })

  it('parses silent link ?[text](url)', () => {
    const tokens = parseMfm('?[silent](https://example.com)')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({
      type: 'link',
      label: [{ type: 'text', value: 'silent' }],
      url: 'https://example.com',
      silent: true,
    })
  })

  it('parses <plain> inside link label', () => {
    const tokens = parseMfm(
      '?[<plain>ふじさんすきー【misskey.day】</plain> (misskey.day)](https://misskey.day)',
    )
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({
      type: 'link',
      label: [
        { type: 'plain', value: 'ふじさんすきー【misskey.day】' },
        { type: 'text', value: ' (misskey.day)' },
      ],
      url: 'https://misskey.day',
      silent: true,
    })
  })

  // MFM function blocks
  it('parses $[fn content]', () => {
    const tokens = parseMfm('$[spin hello]')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('fn')
    const fn = tokens[0] as MfmToken & { type: 'fn' }
    expect(fn.name).toBe('spin')
    expect(fn.args).toEqual({})
    expect(fn.children).toHaveLength(1)
    expect(fn.children[0]).toEqual({ type: 'text', value: 'hello' })
  })

  it('parses $[fn.args content] with key=value args', () => {
    const tokens = parseMfm('$[scale.x=1.2,y=1.2 text]')
    expect(tokens).toHaveLength(1)
    const fn = tokens[0] as MfmToken & { type: 'fn' }
    expect(fn.name).toBe('scale')
    expect(fn.args).toEqual({ x: '1.2', y: '1.2' })
  })

  it('parses $[fn.flag content] with boolean arg', () => {
    const tokens = parseMfm('$[spin.left text]')
    const fn = tokens[0] as MfmToken & { type: 'fn' }
    expect(fn.name).toBe('spin')
    expect(fn.args).toEqual({ left: true })
  })

  it('parses nested $[fn $[fn content]]', () => {
    const tokens = parseMfm('$[spin $[bounce hello]]')
    expect(tokens).toHaveLength(1)
    const outer = tokens[0] as MfmToken & { type: 'fn' }
    expect(outer.name).toBe('spin')
    expect(outer.children).toHaveLength(1)
    const inner = outer.children[0] as MfmToken & { type: 'fn' }
    expect(inner.type).toBe('fn')
    expect(inner.name).toBe('bounce')
    expect(inner.children).toEqual([{ type: 'text', value: 'hello' }])
  })

  it('parses $[fn] containing a link with bracketed label', () => {
    const tokens = parseMfm(
      '$[jelly 🥇: ?[<plain>月</plain>](https://yami.ski/@Ot)]',
    )
    expect(tokens).toHaveLength(1)
    const fn = tokens[0] as MfmToken & { type: 'fn' }
    expect(fn.type).toBe('fn')
    expect(fn.name).toBe('jelly')
    const link = fn.children.find((t) => t.type === 'link') as
      | (MfmToken & { type: 'link' })
      | undefined
    expect(link).toBeDefined()
    expect(link?.url).toBe('https://yami.ski/@Ot')
    expect(link?.silent).toBe(true)
    expect(link?.label).toEqual([{ type: 'plain', value: '月' }])
  })

  it('parses fg/bg color functions', () => {
    const tokens = parseMfm('$[bg.color=51b3fc $[fg.color=000000 text]]')
    const bg = tokens[0] as MfmToken & { type: 'fn' }
    expect(bg.name).toBe('bg')
    expect(bg.args).toEqual({ color: '51b3fc' })
    const fg = bg.children[0] as MfmToken & { type: 'fn' }
    expect(fg.name).toBe('fg')
    expect(fg.args).toEqual({ color: '000000' })
  })

  it('parses custom emoji inside $[fn]', () => {
    const tokens = parseMfm('$[spin :star:]')
    const fn = tokens[0] as MfmToken & { type: 'fn' }
    expect(fn.children).toHaveLength(1)
    expect(fn.children[0]).toEqual({ type: 'customEmoji', shortcode: 'star' })
  })

  // HTML-style tags
  it('parses <small> tag', () => {
    const tokens = parseMfm('<small>small text</small>')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('small')
    const small = tokens[0] as MfmToken & { type: 'small' }
    expect(small.children).toEqual([{ type: 'text', value: 'small text' }])
  })

  it('parses <center> tag', () => {
    const tokens = parseMfm('<center>centered</center>')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('center')
    const center = tokens[0] as MfmToken & { type: 'center' }
    expect(center.children).toEqual([{ type: 'text', value: 'centered' }])
  })

  it('parses <plain> tag (no inner parsing)', () => {
    const tokens = parseMfm('<plain>**not bold** :emoji:</plain>')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('plain')
    const plain = tokens[0] as MfmToken & { type: 'plain' }
    expect(plain.value).toBe('**not bold** :emoji:')
  })

  it('parses inline content around MFM blocks', () => {
    const tokens = parseMfm('before $[spin text] after')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'text', value: 'before ' })
    expect(tokens[1]?.type).toBe('fn')
    expect(tokens[2]).toEqual({ type: 'text', value: ' after' })
  })

  it('treats unclosed $[ as text', () => {
    const tokens = parseMfm('$[invalid')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('text')
  })

  // Blockquote
  it('parses single-line blockquote', () => {
    const tokens = parseMfm('> hello')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('quote')
    const quote = tokens[0] as MfmToken & { type: 'quote' }
    expect(quote.children).toEqual([{ type: 'text', value: 'hello' }])
  })

  it('parses multi-line blockquote', () => {
    const tokens = parseMfm('> line1\n> line2')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('quote')
    const quote = tokens[0] as MfmToken & { type: 'quote' }
    expect(quote.children).toEqual([{ type: 'text', value: 'line1\nline2' }])
  })

  it('parses blockquote with MFM inside', () => {
    const tokens = parseMfm('> **bold** text')
    expect(tokens).toHaveLength(1)
    const quote = tokens[0] as MfmToken & { type: 'quote' }
    expect(quote.children[0]).toEqual({
      type: 'bold',
      children: [{ type: 'text', value: 'bold' }],
    })
  })

  it('parses blockquote with text before and after', () => {
    const tokens = parseMfm('before\n> quoted\nafter')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'text', value: 'before\n' })
    expect(tokens[1]?.type).toBe('quote')
    expect(tokens[2]).toEqual({ type: 'text', value: 'after' })
  })

  it('does not parse > without space as blockquote', () => {
    const tokens = parseMfm('>no space')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('text')
  })

  // Search
  it('parses search syntax with 検索', () => {
    const tokens = parseMfm('Misskey 検索')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('search')
    const search = tokens[0] as MfmToken & { type: 'search' }
    expect(search.query).toBe('Misskey')
  })

  it('parses search syntax with Search', () => {
    const tokens = parseMfm('keyword Search')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('search')
    const search = tokens[0] as MfmToken & { type: 'search' }
    expect(search.query).toBe('keyword')
  })

  it('parses search syntax with [検索]', () => {
    const tokens = parseMfm('テスト [検索]')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('search')
    const search = tokens[0] as MfmToken & { type: 'search' }
    expect(search.query).toBe('テスト')
  })

  it('parses search syntax with [Search]', () => {
    const tokens = parseMfm('test [Search]')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.type).toBe('search')
    const search = tokens[0] as MfmToken & { type: 'search' }
    expect(search.query).toBe('test')
  })

  it('parses search on its own line with surrounding text', () => {
    const tokens = parseMfm('before\nMisskey 検索\nafter')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'text', value: 'before\n' })
    expect(tokens[1]?.type).toBe('search')
    expect(tokens[2]).toEqual({ type: 'text', value: '\nafter' })
  })

  // Math inline
  it('parses inline math \\(formula\\)', () => {
    const tokens = parseMfm('text \\(x^2\\) end')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'text', value: 'text ' })
    expect(tokens[1]).toEqual({ type: 'mathInline', value: 'x^2' })
    expect(tokens[2]).toEqual({ type: 'text', value: ' end' })
  })

  // Math block
  it('parses block math \\[formula\\]', () => {
    const tokens = parseMfm('\\[x^2 + y^2 = z^2\\]')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({ type: 'mathBlock', value: 'x^2 + y^2 = z^2' })
  })

  it('parses block math with surrounding text', () => {
    const tokens = parseMfm('before\n\\[E=mc^2\\]\nafter')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toEqual({ type: 'text', value: 'before\n' })
    expect(tokens[1]).toEqual({ type: 'mathBlock', value: 'E=mc^2' })
    expect(tokens[2]).toEqual({ type: 'text', value: 'after' })
  })

  // $[ruby] and $[unixtime] are parsed as fn tokens
  it('parses $[ruby text reading]', () => {
    const tokens = parseMfm('$[ruby ルビ るび]')
    expect(tokens).toHaveLength(1)
    const fn = tokens[0] as MfmToken & { type: 'fn' }
    expect(fn.name).toBe('ruby')
    expect(fn.children).toEqual([{ type: 'text', value: 'ルビ るび' }])
  })

  it('parses $[unixtime timestamp]', () => {
    const tokens = parseMfm('$[unixtime 1775228400]')
    expect(tokens).toHaveLength(1)
    const fn = tokens[0] as MfmToken & { type: 'fn' }
    expect(fn.name).toBe('unixtime')
    expect(fn.children).toEqual([{ type: 'text', value: '1775228400' }])
  })

  // Invalid/unknown function names
  it('parses $[invalid content] as fn token', () => {
    const tokens = parseMfm('$[invalid x]')
    expect(tokens).toHaveLength(1)
    const fn = tokens[0] as MfmToken & { type: 'fn' }
    expect(fn.name).toBe('invalid')
    expect(fn.children).toEqual([{ type: 'text', value: 'x' }])
  })

  // Nested content in bold/italic/strike
  it('parses nested MFM inside <b> tag', () => {
    const tokens = parseMfm('<b>hello :emoji: world</b>')
    expect(tokens).toHaveLength(1)
    const bold = tokens[0] as MfmToken & { type: 'bold' }
    expect(bold.children).toHaveLength(3)
    expect(bold.children[0]).toEqual({ type: 'text', value: 'hello ' })
    expect(bold.children[1]).toEqual({
      type: 'customEmoji',
      shortcode: 'emoji',
    })
    expect(bold.children[2]).toEqual({ type: 'text', value: ' world' })
  })
})

import { describe, expect, it } from 'vitest'
import type { MisskeyTheme } from '@/theme/types'
import {
  appendBlock,
  mergeThemeUpdate,
  replaceMarkdownSection,
} from './selfEditApply'

describe('appendBlock', () => {
  it('末尾に改行が無ければ 1 つ挟んで連結する', () => {
    expect(appendBlock('body', 'added')).toBe('body\nadded')
  })

  it('末尾が改行なら区切りを足さない', () => {
    expect(appendBlock('body\n', 'added')).toBe('body\nadded')
  })

  it('空の元テキストには先頭改行を入れない', () => {
    expect(appendBlock('', 'added')).toBe('added')
  })
})

describe('replaceMarkdownSection', () => {
  it('`## heading` から次の見出しまでを置換する', () => {
    const body = [
      'intro line',
      '',
      '## Foo',
      'old foo content',
      'still foo',
      '',
      '## Bar',
      'bar content',
    ].join('\n')
    const { body: out, replaced } = replaceMarkdownSection(
      body,
      'Foo',
      'NEW FOO',
    )
    expect(replaced).toBe(true)
    expect(out).toContain('intro line')
    expect(out).toContain('## Foo\n\nNEW FOO')
    expect(out).toContain('## Bar\nbar content')
    expect(out).not.toContain('old foo content')
  })

  it('最後のセクションを置換する (境界 = EOF)', () => {
    const body = '## Foo\nold'
    const { body: out, replaced } = replaceMarkdownSection(body, 'Foo', 'new')
    expect(replaced).toBe(true)
    expect(out).toBe('## Foo\n\nnew')
  })

  it('heading が見つからなければ末尾に新規セクションを足す', () => {
    const body = 'just text'
    const { body: out, replaced } = replaceMarkdownSection(
      body,
      'New',
      'fresh content',
    )
    expect(replaced).toBe(false)
    expect(out).toBe('just text\n\n## New\n\nfresh content')
  })

  it('空の body なら新規セクションだけになる', () => {
    const { body: out, replaced } = replaceMarkdownSection('', 'New', 'x')
    expect(replaced).toBe(false)
    expect(out).toBe('## New\n\nx')
  })

  it('次の h1 で置換を止める (= ## の上位境界)', () => {
    const body = ['## Foo', 'old', '# Section', 'after'].join('\n')
    const { body: out } = replaceMarkdownSection(body, 'Foo', 'new')
    expect(out).toContain('## Foo\n\nnew')
    expect(out).toContain('# Section\nafter')
    expect(out).not.toContain('old')
  })

  it('heading の比較は大文字小文字を区別する (trim のみ)', () => {
    const body = '## Foo Bar\nstuff'
    const { replaced } = replaceMarkdownSection(body, 'foo bar', 'x')
    expect(replaced).toBe(false)
  })

  it('heading の正規表現メタ文字をエスケープする', () => {
    const body = '## A.B (test)\nold'
    const { body: out, replaced } = replaceMarkdownSection(
      body,
      'A.B (test)',
      'new',
    )
    expect(replaced).toBe(true)
    expect(out).toContain('## A.B (test)\n\nnew')
  })
})

describe('mergeThemeUpdate', () => {
  const current: MisskeyTheme = {
    id: 't1',
    name: 'Current',
    base: 'dark',
    props: { accent: '#f00', panel: '#111' },
  }

  it('props patch を既存とマージする (未指定キーは残る)', () => {
    const merged = mergeThemeUpdate(current, { props: { accent: '#0f0' } })
    expect(merged.props).toEqual({ accent: '#0f0', panel: '#111' })
    expect(merged.name).toBe('Current')
    expect(merged.base).toBe('dark')
    expect(merged.id).toBe('t1')
  })

  it('name / base の指定だけを上書きする', () => {
    const merged = mergeThemeUpdate(current, { name: 'Renamed', base: 'light' })
    expect(merged.name).toBe('Renamed')
    expect(merged.base).toBe('light')
    expect(merged.props).toEqual(current.props)
  })

  it('空文字の name は無視して現在値を維持する', () => {
    expect(mergeThemeUpdate(current, { name: '' }).name).toBe('Current')
  })

  it('$notedeck メタデータを引き継ぐ (installedFor を落とさない)', () => {
    const withMeta: MisskeyTheme = {
      ...current,
      $notedeck: { installedFor: ['acc-1'] },
    }
    expect(mergeThemeUpdate(withMeta, {}).$notedeck).toEqual({
      installedFor: ['acc-1'],
    })
  })

  it('base 未設定のテーマは dark に落とす', () => {
    const noBase = { id: 't2', name: 'X', props: {} } as MisskeyTheme
    expect(mergeThemeUpdate(noBase, {}).base).toBe('dark')
  })
})

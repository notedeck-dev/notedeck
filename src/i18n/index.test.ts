import { afterEach, describe, expect, it } from 'vitest'
import { i18n, type Locale, loadLocale, setLocale } from '.'

// 複数形はまだ正本に無いので、形だけの辞書で振る舞いを確かめる
const fixture = {
  greeting: 'こんにちは',
  _ns: {
    hello: '{name} さん、こんにちは',
    items_plural: {
      one: '{count} item in {place}',
      other: '{count} items in {place}',
    },
  },
} as unknown as Locale

// biome-ignore lint/suspicious/noExplicitAny: 形だけの辞書なので型を外して触る
const tsx = () => i18n.tsx as any

describe('i18n', () => {
  afterEach(async () => {
    await loadLocale('ja-JP')
  })

  it('ts は辞書の文言をそのまま返す', () => {
    setLocale('ja-JP', fixture)
    expect((i18n.ts as unknown as { greeting: string }).greeting).toBe(
      'こんにちは',
    )
  })

  it('tsx は param を埋める', () => {
    setLocale('ja-JP', fixture)
    expect(tsx()._ns.hello({ name: 'Ai' })).toBe('Ai さん、こんにちは')
  })

  it('渡されなかった param は {name} のまま残す', () => {
    setLocale('ja-JP', fixture)
    expect(tsx()._ns.hello({})).toBe('{name} さん、こんにちは')
  })

  it('複数形は表示言語の規則でカテゴリを選ぶ', () => {
    setLocale('en-US', fixture)
    expect(tsx()._ns.items_plural({ count: 1, place: 'box' })).toBe(
      '1 item in box',
    )
    expect(tsx()._ns.items_plural({ count: 2, place: 'box' })).toBe(
      '2 items in box',
    )
  })

  it('規則のカテゴリが辞書に無ければ other を使う', () => {
    setLocale('ja-JP', fixture)
    // 日本語の規則は常に other
    expect(tsx()._ns.items_plural({ count: 1, place: 'box' })).toBe(
      '1 items in box',
    )
  })

  it('言語を差し替えると tsx も作り直す', () => {
    setLocale('ja-JP', fixture)
    tsx()._ns.hello({ name: 'a' })
    setLocale('en-US', {
      ...fixture,
      _ns: { hello: 'Hi {name}' },
    } as unknown as Locale)
    expect(tsx()._ns.hello({ name: 'a' })).toBe('Hi a')
    expect(i18n.lang).toBe('en-US')
  })

  it('loadLocale は合成済みの辞書を読み、欠けたキーは原文で埋まっている', async () => {
    await loadLocale('en-US')
    expect(i18n.ts._time.justNow).toBe('just now')
    await loadLocale('ja-JP')
    expect(i18n.ts._time.justNow).toBe('たった今')
  })
})

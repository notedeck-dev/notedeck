import { describe, expect, it } from 'vitest'
import {
  casefold,
  composeSuffixed,
  isSlugConforming,
  resolveAvailable,
  SLUG_MAX_LENGTH,
  slugifyName,
} from './settingsSlug'

describe('slugifyName', () => {
  it('英数字名を小文字 slug にする', () => {
    expect(slugifyName('My Theme', 'theme')).toBe('my-theme')
    expect(slugifyName('Weather_2', 'widget')).toBe('weather-2')
  })

  it('日本語のみの名前は fallback に落ちる', () => {
    expect(slugifyName('日本語だけ', 'widget')).toBe('widget')
    // 数字が残る場合は fallback しない (R1 裁定: 不格好だが規約適合・一意)
    expect(slugifyName('プロファイル 1', 'profile')).toBe('1')
  })

  it('連続ハイフンを圧縮し端のハイフンを除去する', () => {
    expect(slugifyName('foo--bar', 'x')).toBe('foo-bar')
    expect(slugifyName('-foo-', 'x')).toBe('foo')
    expect(slugifyName('  spaced  name  ', 'x')).toBe('spaced-name')
  })

  it('Windows 予約デバイス名を回避する', () => {
    expect(slugifyName('CON', 'theme')).toBe('con-x')
    expect(slugifyName('aux', 'theme')).toBe('aux-x')
    expect(slugifyName('Com1', 'theme')).toBe('com1-x')
    expect(slugifyName('lpt9', 'theme')).toBe('lpt9-x')
    // 予約名を含むだけの語は対象外
    expect(slugifyName('auxiliary', 'theme')).toBe('auxiliary')
    expect(slugifyName('console', 'theme')).toBe('console')
  })

  it('48 文字に切り詰め、切断で生じた末尾ハイフンを除去する', () => {
    const long = 'a'.repeat(60)
    expect(slugifyName(long, 'x')).toBe('a'.repeat(SLUG_MAX_LENGTH))
    // 48 文字目がハイフンになるケース
    const hyphenAtCut = `${'a'.repeat(47)}-bbbb`
    const result = slugifyName(hyphenAtCut, 'x')
    expect(result).toBe('a'.repeat(47))
    expect(isSlugConforming(result)).toBe(true)
  })

  it('出力は常に不動点（再適用しても変わらない）', () => {
    const samples = [
      'My Theme',
      'プロファイル 1',
      'CON',
      'foo--bar-',
      'a'.repeat(60),
      `${'x'.repeat(47)}-tail`,
      '★絵文字🎉と mixed ABC',
    ]
    for (const s of samples) {
      const slug = slugifyName(s, 'kind')
      expect(slugifyName(slug, 'kind')).toBe(slug)
      expect(isSlugConforming(slug)).toBe(true)
    }
  })
})

describe('isSlugConforming', () => {
  it('slugify の不動点のみ適合とする', () => {
    expect(isSlugConforming('weather')).toBe(true)
    expect(isSlugConforming('my-theme-2')).toBe(true)
    expect(isSlugConforming('Weather')).toBe(false)
    expect(isSlugConforming('foo--bar')).toBe(false)
    expect(isSlugConforming('-foo')).toBe(false)
    expect(isSlugConforming('foo.bar')).toBe(false)
    expect(isSlugConforming('日本語')).toBe(false)
    expect(isSlugConforming('')).toBe(false)
    expect(isSlugConforming('a'.repeat(49))).toBe(false)
  })

  it('Windows 予約デバイス名は不適合', () => {
    expect(isSlugConforming('con')).toBe(false)
    expect(isSlugConforming('nul')).toBe(false)
    expect(isSlugConforming('com1')).toBe(false)
    expect(isSlugConforming('con-x')).toBe(true)
  })
})

describe('composeSuffixed', () => {
  it('base に -n を付ける', () => {
    expect(composeSuffixed('foo', 2)).toBe('foo-2')
    expect(composeSuffixed('foo', 10)).toBe('foo-10')
  })

  it('合計が上限を超える場合は base 側を切り詰めてから付与する', () => {
    const base = 'a'.repeat(SLUG_MAX_LENGTH)
    const result = composeSuffixed(base, 2)
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(result.endsWith('-2')).toBe(true)
    expect(isSlugConforming(result)).toBe(true)
  })

  it('切り詰めで末尾ハイフンが生じても不動点を保つ', () => {
    // 46 文字 + '-' + 1 文字 = 48 文字。suffix '-2' で切ると 46 文字目が '-'
    const base = `${'a'.repeat(45)}-bb`
    const result = composeSuffixed(base, 2)
    expect(isSlugConforming(result)).toBe(true)
    expect(result.endsWith('-2')).toBe(true)
  })
})

describe('resolveAvailable', () => {
  it('base が空いていればそのまま返す', () => {
    expect(resolveAvailable('foo', () => false)).toBe('foo')
  })

  it('占有されていれば -2 から昇順で探す', () => {
    const taken = new Set(['foo', 'foo-2', 'foo-3'])
    expect(resolveAvailable('foo', (c) => taken.has(c))).toBe('foo-4')
  })

  it('占有判定は呼び出し側の述語に委ねる（casefold は述語側の責務）', () => {
    const taken = new Set(['dark'])
    expect(
      resolveAvailable('Dark'.toLowerCase(), (c) => taken.has(casefold(c))),
    ).toBe('dark-2')
  })
})

describe('casefold', () => {
  it('ASCII の大文字小文字を潰す', () => {
    expect(casefold('Dark.NDTheme.JSON5')).toBe('dark.ndtheme.json5')
  })
})

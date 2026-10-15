import { describe, expect, it } from 'vitest'
import {
  isValidThemeId,
  misskeyThemeOf,
  sameThemeContent,
  type ThemeFileInput,
  type ThemeItem,
  themeCodec,
  themeHasTimestamps,
} from '@/services/distributableCodecs/themeCodec'

const ctx = { filename: 't.ndtheme.json5', now: 42 }

function read(file: ThemeFileInput): ThemeItem {
  return themeCodec.fromFile(file, ctx)
}

function item(patch: Partial<ThemeItem> = {}): ThemeItem {
  return {
    id: 't',
    name: 'T',
    createdAt: 1,
    updatedAt: 2,
    scope: { kind: 'shared', global: false, installedFor: [] },
    content: { base: 'light', props: { bg: '#fff' } },
    extra: {},
    ...patch,
  }
}

describe('isValidThemeId', () => {
  it('1〜256 文字の文字列だけを有効とする', () => {
    expect(isValidThemeId('a')).toBe(true)
    expect(isValidThemeId('a'.repeat(256))).toBe(true)
    expect(isValidThemeId('a'.repeat(257))).toBe(false)
    expect(isValidThemeId('')).toBe(false)
    expect(isValidThemeId(1)).toBe(false)
    expect(isValidThemeId(undefined)).toBe(false)
  })
})

describe('themeCodec.fromFile', () => {
  it('空のファイルは ID を custom-<完全ファイル名>、名前をファイル名、dark・props 空で埋める', () => {
    expect(read({})).toEqual({
      id: 'custom-t.ndtheme.json5',
      name: 't.ndtheme.json5',
      createdAt: 42,
      updatedAt: 42,
      store: undefined,
      scope: { kind: 'shared', global: false, installedFor: [] },
      content: { base: 'dark', props: {} },
      extra: {},
    })
  })

  it('257 文字以上の ID は欠損として custom-<ファイル名> にする', () => {
    expect(read({ id: 'a'.repeat(257) }).id).toBe('custom-t.ndtheme.json5')
  })

  it("base は 'light' のときだけ light で、それ以外は dark", () => {
    expect(read({ base: 'light' }).content.base).toBe('light')
    expect(read({ base: 'Light' as unknown as 'light' }).content.base).toBe(
      'dark',
    )
  })

  it('$notedeck.installedFor をスコープに写し、global は常に false', () => {
    expect(read({ $notedeck: { installedFor: ['h:u'] } }).scope).toEqual({
      kind: 'shared',
      global: false,
      installedFor: ['h:u'],
    })
  })

  it('$notedeck の時刻が数値でなければ now で埋める', () => {
    const it_ = read({
      $notedeck: { createdAt: '1' as unknown as number, updatedAt: 0 },
    })
    expect(it_.createdAt).toBe(42)
    expect(it_.updatedAt).toBe(0)
  })

  it('ストア 3 点は storeId があるときだけ store になる', () => {
    expect(read({ $notedeck: { storeSha512: 'h' } }).store).toBeUndefined()
    expect(
      read({ $notedeck: { storeId: 's', storeSha512: 'h' } }).store,
    ).toEqual({ id: 's', sha512: 'h' })
  })

  it('description / iconUrl は持たない', () => {
    const it_ = read({})
    expect('description' in it_).toBe(false)
    expect('iconUrl' in it_).toBe(false)
  })
})

describe('themeCodec.toFile', () => {
  it('上位は id, name, base, props, $notedeck の順で、$notedeck は時刻だけ', () => {
    const file = themeCodec.toFile(item())
    expect(Object.keys(file)).toEqual([
      'id',
      'name',
      'base',
      'props',
      '$notedeck',
    ])
    expect(file.$notedeck).toEqual({ createdAt: 1, updatedAt: 2 })
  })

  it('$notedeck はストア 3 点, installedFor, 時刻の順', () => {
    const file = themeCodec.toFile(
      item({
        store: { id: 's', sha512: 'h', version: '1' },
        scope: { kind: 'shared', global: false, installedFor: ['h:u'] },
      }),
    )
    expect(Object.keys(file.$notedeck ?? {})).toEqual([
      'storeId',
      'storeSha512',
      'storeVersion',
      'installedFor',
      'createdAt',
      'updatedAt',
    ])
  })

  it('global: true のスコープでも global は書かない', () => {
    const file = themeCodec.toFile(
      item({ scope: { kind: 'shared', global: true, installedFor: [] } }),
    )
    expect('global' in (file.$notedeck ?? {})).toBe(false)
    expect('installedFor' in (file.$notedeck ?? {})).toBe(false)
  })

  it('scope が none のときは installedFor を書かない', () => {
    const file = themeCodec.toFile(item({ scope: { kind: 'none' } }))
    expect('installedFor' in (file.$notedeck ?? {})).toBe(false)
  })
})

describe('themeCodec の往復', () => {
  it('envelope → テキスト → envelope で元に戻る', () => {
    const original = item({
      store: { id: 's', version: '2' },
      scope: { kind: 'shared', global: false, installedFor: ['h:u', 'h:v'] },
      content: { base: 'dark', props: { a: '#000', b: '@a' } },
    })
    const text = themeCodec.encode(themeCodec.toFile(original))
    expect(themeCodec.fromFile(themeCodec.decode(text), ctx)).toEqual(original)
  })

  it('壊れた JSON5 の decode は throw する', () => {
    expect(() => themeCodec.decode('{ id: ')).toThrow()
  })

  it('書いたものは outdated でない', () => {
    expect(themeCodec.outdated(themeCodec.toFile(item()))).toBe(false)
  })
})

describe('themeHasTimestamps / themeCodec.outdated', () => {
  it('createdAt / updatedAt が両方数値のときだけ時刻が揃っている', () => {
    expect(themeHasTimestamps({ createdAt: 1, updatedAt: 2 })).toBe(true)
    expect(themeHasTimestamps({ createdAt: 1 })).toBe(false)
    expect(themeHasTimestamps(undefined)).toBe(false)
  })

  it('$notedeck が無いファイルは古い', () => {
    expect(themeCodec.outdated({ id: 'x', props: {} })).toBe(true)
  })

  it('有効の宣言は持たない (選択は settings 側)', () => {
    expect(themeCodec.enabled).toBeUndefined()
  })
})

describe('misskeyThemeOf', () => {
  it('id / name / base / props だけの Misskey 互換の形にする', () => {
    expect(misskeyThemeOf(item({ store: { id: 's' }, fileBase: 'x' }))).toEqual(
      {
        id: 't',
        name: 'T',
        base: 'light',
        props: { bg: '#fff' },
      },
    )
  })
})

describe('sameThemeContent', () => {
  it('base と props が同じならキー順が違っても同一', () => {
    expect(
      sameThemeContent(
        { base: 'dark', props: { a: '1', b: '2' } },
        { base: 'dark', props: { b: '2', a: '1' } },
      ),
    ).toBe(true)
  })

  it('base が違えば別物', () => {
    expect(
      sameThemeContent(
        { base: 'dark', props: {} },
        { base: 'light', props: {} },
      ),
    ).toBe(false)
  })

  it('props の数や値が違えば別物', () => {
    expect(
      sameThemeContent(
        { base: 'dark', props: { a: '1' } },
        { base: 'dark', props: { a: '1', b: '2' } },
      ),
    ).toBe(false)
    expect(
      sameThemeContent(
        { base: 'dark', props: { a: '1' } },
        { base: 'dark', props: { a: '2' } },
      ),
    ).toBe(false)
  })
})

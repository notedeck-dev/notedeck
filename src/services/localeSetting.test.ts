import { describe, expect, it } from 'vitest'
import {
  initialLocaleSetting,
  parseLocaleSetting,
  resolveLanguage,
  serializeLocaleSetting,
} from './localeSetting'

const LANGS = [
  { code: 'ja-JP', published: true },
  { code: 'en-US', published: true },
  { code: 'zh-CN', published: true },
  { code: 'ko-KR', published: false },
] as const

describe('resolveLanguage', () => {
  it('明示された言語はそのまま使う (未公開でも)', () => {
    expect(resolveLanguage('ko-KR', ['en-US'], LANGS)).toBe('ko-KR')
  })

  it('知らない言語コードが明示されていたら auto として扱う', () => {
    expect(resolveLanguage('xx-XX', ['ja-JP'], LANGS)).toBe('ja-JP')
  })

  it('auto は OS 言語の完全一致を優先する', () => {
    expect(resolveLanguage('auto', ['en-US', 'ja-JP'], LANGS)).toBe('en-US')
  })

  it('auto は大文字小文字を区別せずに一致させる', () => {
    expect(resolveLanguage('auto', ['ja-jp'], LANGS)).toBe('ja-JP')
  })

  it('auto は言語部だけの一致でも拾う (en-GB → en-US)', () => {
    expect(resolveLanguage('auto', ['en-GB'], LANGS)).toBe('en-US')
    expect(resolveLanguage('auto', ['ja'], LANGS)).toBe('ja-JP')
  })

  it('zh は完全一致のみ (繁体を簡体に落とさない)', () => {
    expect(resolveLanguage('auto', ['zh-TW'], LANGS)).toBe('en-US')
    expect(resolveLanguage('auto', ['zh-CN'], LANGS)).toBe('zh-CN')
  })

  it('auto は未公開の言語に解決しない', () => {
    expect(resolveLanguage('auto', ['ko-KR'], LANGS)).toBe('en-US')
  })

  it('一致が無ければ en-US、en-US が未公開なら最初の公開言語', () => {
    expect(resolveLanguage('auto', ['fr-FR'], LANGS)).toBe('en-US')
    const jaOnly = [
      { code: 'ja-JP', published: true },
      { code: 'en-US', published: false },
    ] as const
    expect(resolveLanguage('auto', ['fr-FR'], jaOnly)).toBe('ja-JP')
    expect(resolveLanguage('auto', ['en-US'], jaOnly)).toBe('ja-JP')
  })
})

describe('locale.json5 の codec', () => {
  it('空はファイル未作成 (null)', () => {
    expect(parseLocaleSetting('')).toBeNull()
    expect(parseLocaleSetting('  \n')).toBeNull()
  })

  it('壊れた内容は auto として読む', () => {
    expect(parseLocaleSetting('{ locale: ')).toEqual({ locale: 'auto' })
    expect(parseLocaleSetting('{ locale: 3 }')).toEqual({ locale: 'auto' })
  })

  it('書いた内容を読み戻せる', () => {
    const setting = { locale: 'ja-JP', migrated: true } as const
    expect(parseLocaleSetting(serializeLocaleSetting(setting))).toEqual(setting)
    expect(
      parseLocaleSetting(serializeLocaleSetting({ locale: 'auto' })),
    ).toEqual({ locale: 'auto' })
  })
})

describe('initialLocaleSetting', () => {
  it('既存インストールは ja-JP に固定し、移行由来の印を付ける', () => {
    expect(initialLocaleSetting(true)).toEqual({
      locale: 'ja-JP',
      migrated: true,
    })
  })

  it('新規インストールは auto', () => {
    expect(initialLocaleSetting(false)).toEqual({ locale: 'auto' })
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { loadLocale } from '.'
import { localizeNative, nativeField } from './native'

describe('localizeNative', () => {
  afterEach(async () => {
    await loadLocale('ja-JP')
  })

  it('i18n の手がかりがある欄を表示言語で描き直し、ほかの欄は残す', () => {
    const out = localizeNative({
      title: 'Run X?',
      okLabel: 'Run',
      type: 'danger',
      i18n: {
        title: {
          key: '_native.preview.generic.title',
          params: { label: 'X' },
        },
        okLabel: { key: '_native.preview.generic.ok', params: {} },
      },
    })
    expect(out).toEqual({
      title: 'X を実行しますか？',
      okLabel: '実行',
      type: 'danger',
    })
  })

  it('capability の param があれば、表示名を表示言語の辞書で引き直す', () => {
    const out = localizeNative({
      title: 'Run Get current time?',
      i18n: {
        title: {
          key: '_native.preview.generic.title',
          params: { label: 'Get current time', capability: 'time.now' },
        },
      },
    })
    expect(out.title).toBe('現在時刻を取得 を実行しますか？')
  })

  it('辞書に無いキーは英語の正本文のまま出す', () => {
    const out = localizeNative({
      title: 'Canonical',
      i18n: { title: { key: '_native.gone', params: {} } },
    })
    expect(out.title).toBe('Canonical')
  })

  it('入れ子のオブジェクトの手がかりも描き直す', () => {
    const out = localizeNative({
      title: 'x',
      installPreview: {
        kind: 'theme',
        description: 'dark theme',
        i18n: {
          description: {
            key: '_native.preview.themes.update.description',
            params: { base: 'dark' },
          },
        },
      },
    })
    expect(out).toEqual({
      title: 'x',
      installPreview: { kind: 'theme', description: 'dark テーマ' },
    })
  })

  it('手がかりが無ければそのまま返す', () => {
    expect(localizeNative({ title: 'x' })).toEqual({ title: 'x' })
  })

  it('nativeField は 1 欄だけ描き直し、元の値は変えない', () => {
    const msg = {
      content: 'Run X?',
      i18n: {
        content: {
          key: '_native.preview.generic.title',
          params: { label: 'X' },
        },
      },
    }
    expect(nativeField(msg, 'content')).toBe('X を実行しますか？')
    expect(msg.content).toBe('Run X?')
    expect(nativeField({ title: 'plain' }, 'title')).toBe('plain')
  })
})

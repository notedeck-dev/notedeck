import { describe, expect, it } from 'vitest'
import {
  EDIT_HISTORY_SPECS,
  historyDiffPair,
  themeFromSnapshot,
} from './editHistory'

describe('EDIT_HISTORY_SPECS', () => {
  it('履歴を持つ 5 種別すべてに spec がある', () => {
    expect(Object.keys(EDIT_HISTORY_SPECS).sort()).toEqual([
      'css',
      'plugin',
      'skill',
      'theme',
      'widget',
    ])
  })

  it('skill: markdown body を全文として扱う', () => {
    const spec = EDIT_HISTORY_SPECS.skill
    expect(spec.language).toBe('markdown')
    expect(spec.snapshotText({ body: '# 見出し' })).toBe('# 見出し')
    expect(spec.revertParams('sk-1', 2)).toEqual({ id: 'sk-1', index: 2 })
  })

  it('plugin / widget: AiScript src を全文として扱う', () => {
    expect(EDIT_HISTORY_SPECS.plugin.language).toBe('aiscript')
    expect(EDIT_HISTORY_SPECS.plugin.snapshotText({ src: 'let x = 1' })).toBe(
      'let x = 1',
    )
    expect(EDIT_HISTORY_SPECS.widget.revertParams('w-1', 0)).toEqual({
      installId: 'w-1',
      index: 0,
    })
  })

  it('theme: props だけでなくテーマ全体を JSON として見せる', () => {
    const text = EDIT_HISTORY_SPECS.theme.snapshotText({
      id: 't1',
      name: 'T',
      base: 'dark',
      props: { accent: '#f00' },
    })
    expect(text).toContain('"name": "T"')
    expect(text).toContain('"accent": "#f00"')
    expect(EDIT_HISTORY_SPECS.theme.language).toBe('json5')
  })

  it('css: 単一ファイルなので revert に id を渡さない', () => {
    expect(EDIT_HISTORY_SPECS.css.revertParams('', 1)).toEqual({ index: 1 })
    expect(EDIT_HISTORY_SPECS.css.snapshotText({ body: '.a{}' })).toBe('.a{}')
  })

  it('壊れた snapshot は空文字にする (履歴表示で落とさない)', () => {
    for (const spec of Object.values(EDIT_HISTORY_SPECS)) {
      expect(spec.snapshotText(null)).toBe('')
      expect(spec.snapshotText('not an object')).toBe('')
    }
  })
})

describe('themeFromSnapshot', () => {
  it('snapshot からテーマ本体を復元する', () => {
    expect(
      themeFromSnapshot({
        id: 't1',
        name: 'T',
        base: 'light',
        props: { accent: '#f00' },
      }),
    ).toEqual({
      id: 't1',
      name: 'T',
      base: 'light',
      props: { accent: '#f00' },
    })
  })

  it('欠けたフィールドは既定値で埋める', () => {
    expect(themeFromSnapshot(null)).toEqual({
      id: '',
      name: '',
      base: 'dark',
      props: {},
    })
  })
})

describe('historyDiffPair', () => {
  const texts = ['三世代前', '二世代前', '一世代前']

  it('最新 snapshot は現在の内容と比べる', () => {
    expect(historyDiffPair(texts, 0, 'いまの内容')).toEqual({
      old: '三世代前',
      new: 'いまの内容',
    })
  })

  it('古い snapshot は 1 つ新しい snapshot と比べる (その編集の差分)', () => {
    expect(historyDiffPair(texts, 2, 'いまの内容')).toEqual({
      old: '一世代前',
      new: '二世代前',
    })
  })

  it('範囲外の index は null', () => {
    expect(historyDiffPair(texts, 3, 'x')).toBeNull()
    expect(historyDiffPair([], 0, 'x')).toBeNull()
  })
})

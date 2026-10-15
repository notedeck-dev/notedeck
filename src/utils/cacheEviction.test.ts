import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { PRESET_OPTIONS } from './cacheEviction'

describe('PRESET_OPTIONS', () => {
  it('検索優先 → バランス → ストレージ優先 → カスタムの順に並ぶ', () => {
    expect(PRESET_OPTIONS.map((o) => o.value)).toEqual([
      'search-priority',
      'balanced',
      'storage-priority',
      'custom',
    ])
  })

  it('label / hint は表示言語の辞書から引いた空でない文字列', () => {
    for (const o of PRESET_OPTIONS) {
      expect(o.label.trim(), o.value).not.toBe('')
      expect(o.hint.trim(), o.value).not.toBe('')
      expect(o.label, o.value).not.toBe(o.hint)
    }
    expect(PRESET_OPTIONS[0]?.label).toBe(i18n.ts._cacheEviction.searchPriority)
    expect(PRESET_OPTIONS[3]?.hint).toBe(i18n.ts._cacheEviction.customHint)
  })

  it('label はアクセスのたびに辞書を読む getter になっている', () => {
    const desc = Object.getOwnPropertyDescriptor(PRESET_OPTIONS[1], 'label')
    expect(typeof desc?.get).toBe('function')
  })
})

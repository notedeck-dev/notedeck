import { describe, expect, it } from 'vitest'
import { getAccountScope, isAllAccounts } from '@/columns/accountScope'
import {
  ACCOUNT_INDEPENDENT_TYPES,
  CROSS_ACCOUNT_TYPES,
  registerColumnType,
  unregisterColumnType,
} from '@/columns/registry'
import type { DeckColumn } from '@/stores/deck'

function column(part: Partial<DeckColumn>): DeckColumn {
  return {
    id: 'c1',
    type: 'timeline',
    name: null,
    width: 360,
    accountId: null,
    ...part,
  } as DeckColumn
}

describe('getAccountScope — 「全アカウント」と「アカウントなし」の区別 (#1018)', () => {
  it('accountId があれば種別によらず account', () => {
    expect(getAccountScope(column({ type: 'timeline', accountId: 'a1' }))).toBe(
      'account',
    )
    // 本来 accountId を持たない種別でも、付いていれば per-account として扱う
    expect(getAccountScope(column({ type: 'ai', accountId: 'a1' }))).toBe(
      'account',
    )
  })

  it('accountId なし + cross-account 種別なら all', () => {
    expect(getAccountScope(column({ type: 'notifications' }))).toBe('all')
    expect(getAccountScope(column({ type: 'chat' }))).toBe('all')
  })

  it('accountId なし + アカウント非依存の種別なら none', () => {
    expect(getAccountScope(column({ type: 'ai' }))).toBe('none')
    expect(getAccountScope(column({ type: 'skill' }))).toBe('none')
  })

  it('accountId なし + アカウント任意の種別で「なし」を選んだ場合も none', () => {
    expect(getAccountScope(column({ type: 'aiscript' }))).toBe('none')
  })

  it('accountId が消えた per-account 種別は none に倒す (束ねる対象がない)', () => {
    expect(getAccountScope(column({ type: 'timeline' }))).toBe('none')
  })

  it('registry の 2 つの集合は排他 — 種別から意味が一意に復元できる', () => {
    for (const type of CROSS_ACCOUNT_TYPES) {
      expect(ACCOUNT_INDEPENDENT_TYPES.has(type)).toBe(false)
    }
  })

  it('実行時登録された種別にも追随する', () => {
    registerColumnType('pluginCross', {
      label: 'Plugin Cross',
      icon: 'puzzle',
      group: 'tool',
      crossAccount: true,
      component: () => Promise.resolve({ default: {} }),
    })
    try {
      expect(getAccountScope(column({ type: 'pluginCross' }))).toBe('all')
    } finally {
      unregisterColumnType('pluginCross')
    }
    // 登録解除後は cross-account の根拠が消えるので none
    expect(getAccountScope(column({ type: 'pluginCross' }))).toBe('none')
  })
})

describe('isAllAccounts', () => {
  it('全アカウントのカラムだけ true', () => {
    expect(isAllAccounts(column({ type: 'notifications' }))).toBe(true)
    expect(isAllAccounts(column({ type: 'ai' }))).toBe(false)
    expect(
      isAllAccounts(column({ type: 'notifications', accountId: 'a1' })),
    ).toBe(false)
  })

  it('カラムが無ければ false (undefined 安全)', () => {
    expect(isAllAccounts(null)).toBe(false)
    expect(isAllAccounts(undefined)).toBe(false)
  })
})

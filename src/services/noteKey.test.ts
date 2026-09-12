import { describe, expect, it } from 'vitest'
import {
  nestedVariantKey,
  parseVariantKey,
  variantKey,
  variantKeyOf,
} from './noteKey'

describe('variantKey', () => {
  it('同じノート ID でもアカウントが違えば別キーになる (#1010)', () => {
    expect(variantKey('acc-a', 'n1')).not.toBe(variantKey('acc-b', 'n1'))
  })

  it('往復できる', () => {
    const key = variantKey('acc-a', 'n1')
    expect(parseVariantKey(key)).toEqual({ accountId: 'acc-a', noteId: 'n1' })
  })

  it('入れ子は親の取得元アカウントに属する', () => {
    const parent = { _accountId: 'acc-a', id: 'outer' }
    expect(nestedVariantKey(parent, 'inner')).toBe(variantKey('acc-a', 'inner'))
    expect(variantKeyOf(parent)).toBe(variantKey('acc-a', 'outer'))
  })
})

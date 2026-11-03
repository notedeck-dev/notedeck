import { describe, expect, it } from 'vitest'
import { invokeErrorText } from './aiInvokeError'

// AI ターンの invoke が本文の無い失敗で reject したとき「⚠️ null」を出さない (#1317)
describe('invokeErrorText', () => {
  it('本文が無い reject は null (呼び出し側が既定の文言にする)', () => {
    expect(invokeErrorText(null)).toBeNull()
    expect(invokeErrorText(undefined)).toBeNull()
    expect(invokeErrorText('')).toBeNull()
    expect(invokeErrorText('   ')).toBeNull()
    expect(invokeErrorText({})).toBeNull()
    expect(invokeErrorText({ message: null })).toBeNull()
  })

  it('読める本文はそのまま返す', () => {
    expect(invokeErrorText('HTTP 400: bad request')).toBe(
      'HTTP 400: bad request',
    )
    expect(invokeErrorText(new Error('boom'))).toBe('boom')
    expect(
      invokeErrorText({ code: 'INVALID_INPUT', message: 'model is empty' }),
    ).toBe('model is empty')
    expect(invokeErrorText({ code: 'NETWORK' })).toBe('NETWORK')
  })
})

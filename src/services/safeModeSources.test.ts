import { describe, expect, it } from 'vitest'
import { resolveSafeMode } from './safeModeSources'

describe('resolveSafeMode', () => {
  it('保存済みフラグがあれば true', () => {
    expect(
      resolveSafeMode({ argFlag: false, search: '', stored: 'true' }),
    ).toBe(true)
  })

  it('CLI 引数フラグで true', () => {
    expect(resolveSafeMode({ argFlag: true, search: '', stored: null })).toBe(
      true,
    )
  })

  it('URL クエリ ?safemode=true で true', () => {
    expect(
      resolveSafeMode({
        argFlag: false,
        search: '?safemode=true',
        stored: null,
      }),
    ).toBe(true)
  })

  it('?safemode 単独 / 他の値では有効化しない (誤爆防止)', () => {
    expect(
      resolveSafeMode({ argFlag: false, search: '?safemode', stored: null }),
    ).toBe(false)
    expect(
      resolveSafeMode({
        argFlag: false,
        search: '?safemode=false',
        stored: null,
      }),
    ).toBe(false)
  })

  it('どの経路もなければ false', () => {
    expect(
      resolveSafeMode({ argFlag: false, search: '?foo=1', stored: null }),
    ).toBe(false)
  })

  it('保存値が "true" 以外なら無効 (壊れた値で居座らせない)', () => {
    expect(resolveSafeMode({ argFlag: false, search: '', stored: '1' })).toBe(
      false,
    )
  })
})

import { describe, expect, it } from 'vitest'
import { resolveCodeScheme } from './useCodeScheme'

describe('resolveCodeScheme', () => {
  it('明示指定はアプリのテーマに関係なくそのまま使う', () => {
    expect(resolveCodeScheme('dark', false)).toBe('dark')
    expect(resolveCodeScheme('light', true)).toBe('light')
  })

  it('auto はアプリのテーマに追従する', () => {
    expect(resolveCodeScheme('auto', true)).toBe('dark')
    expect(resolveCodeScheme('auto', false)).toBe('light')
  })

  it('未設定は auto 扱い (既定はテーマ追従)', () => {
    expect(resolveCodeScheme(undefined, true)).toBe('dark')
    expect(resolveCodeScheme(undefined, false)).toBe('light')
  })
})

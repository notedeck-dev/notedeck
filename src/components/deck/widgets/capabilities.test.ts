import { describe, expect, it } from 'vitest'
import { checkKnownCapabilities, checkWidgetCapabilities } from './capabilities'

describe('checkKnownCapabilities', () => {
  it('既知 capability のみなら互換 (アカウント条件は見ない)', () => {
    const result = checkKnownCapabilities([
      'misskey-api',
      'misskey-account',
      'notedeck-api',
      'secret-vault',
    ])
    expect(result).toEqual({ ok: true, badge: null, reason: null })
  })

  it('未知 capability は「未対応の機能」として非互換', () => {
    const result = checkKnownCapabilities(['future-thing'])
    expect(result.ok).toBe(false)
    expect(result.badge).toBe('要アップデート')
    expect(result.reason).toContain('未対応の機能: future-thing')
  })
})

describe('checkWidgetCapabilities', () => {
  it('capability なしはどのカラムでも互換', () => {
    expect(checkWidgetCapabilities([], { accountId: null }).ok).toBe(true)
  })

  it('notedeck-api は accountId なし (cross-account) でも互換', () => {
    const result = checkWidgetCapabilities(['notedeck-api'], {
      accountId: null,
    })
    expect(result).toEqual({ ok: true, badge: null, reason: null })
  })

  it('secret-vault は accountId なし (cross-account) でも互換', () => {
    const result = checkWidgetCapabilities(['secret-vault'], {
      accountId: null,
    })
    expect(result).toEqual({ ok: true, badge: null, reason: null })
  })

  it('misskey-api は accountId 必須 (非互換は「要アカウント」)', () => {
    const missing = checkWidgetCapabilities(['misskey-api'], {
      accountId: null,
    })
    expect(missing.ok).toBe(false)
    expect(missing.badge).toBe('要アカウント')
    expect(
      checkWidgetCapabilities(['misskey-api'], { accountId: 'a1' }).ok,
    ).toBe(true)
  })

  it('misskey-account は accountId 必須 (非互換は「要ログイン」)', () => {
    const missing = checkWidgetCapabilities(['misskey-account'], {
      accountId: null,
    })
    expect(missing.ok).toBe(false)
    expect(missing.badge).toBe('要ログイン')
    expect(
      checkWidgetCapabilities(['misskey-account'], { accountId: 'a1' }).ok,
    ).toBe(true)
  })

  it('未知 capability は「未対応の機能」として非互換', () => {
    const result = checkWidgetCapabilities(['future-thing'], {
      accountId: 'a1',
    })
    expect(result.ok).toBe(false)
    expect(result.badge).toBe('要アップデート')
    expect(result.reason).toContain('未対応の機能: future-thing')
  })
})

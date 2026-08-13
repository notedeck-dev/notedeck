import { describe, expect, it } from 'vitest'
import {
  checkKnownCapabilities,
  checkWidgetCapabilities,
  requiresAccount,
} from './capabilities'

describe('requiresAccount', () => {
  it('Misskey に触る capability を含むときだけ true', () => {
    expect(requiresAccount(['misskey-api'])).toBe(true)
    expect(requiresAccount(['misskey-account'])).toBe(true)
    expect(requiresAccount(['notedeck-api', 'misskey-api'])).toBe(true)
  })

  it('アカウントに依存しない capability だけなら false', () => {
    expect(requiresAccount([])).toBe(false)
    expect(requiresAccount(['notedeck-api', 'secret-vault'])).toBe(false)
  })
})

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

  describe('全アカウントのカラム — インストール時にアカウントを選べる (#1018)', () => {
    it('アカウントを選べるならアカウント必須の capability も互換', () => {
      const ctx = { accountId: null, canPickAccount: true }
      expect(checkWidgetCapabilities(['misskey-api'], ctx).ok).toBe(true)
      expect(checkWidgetCapabilities(['misskey-account'], ctx).ok).toBe(true)
    })

    it('選べる相手がいなければ従来どおり非互換', () => {
      const ctx = { accountId: null, canPickAccount: false }
      expect(checkWidgetCapabilities(['misskey-api'], ctx).badge).toBe(
        '要アカウント',
      )
      expect(checkWidgetCapabilities(['misskey-account'], ctx).badge).toBe(
        '要ログイン',
      )
    })

    it('未知 capability は選べても非互換のまま', () => {
      const result = checkWidgetCapabilities(['future-thing'], {
        accountId: null,
        canPickAccount: true,
      })
      expect(result.badge).toBe('要アップデート')
    })
  })
})

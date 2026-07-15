import { describe, expect, it } from 'vitest'
import { checkWidgetCapabilities } from './capabilities'

describe('checkWidgetCapabilities', () => {
  it('capability なしはどのカラムでも互換', () => {
    expect(checkWidgetCapabilities([], { accountId: null }).ok).toBe(true)
  })

  it('notedeck-api は accountId なし (cross-account) でも互換', () => {
    const result = checkWidgetCapabilities(['notedeck-api'], {
      accountId: null,
    })
    expect(result).toEqual({ ok: true, reason: null })
  })

  it('misskey-api は accountId 必須', () => {
    expect(
      checkWidgetCapabilities(['misskey-api'], { accountId: null }).ok,
    ).toBe(false)
    expect(
      checkWidgetCapabilities(['misskey-api'], { accountId: 'a1' }).ok,
    ).toBe(true)
  })

  it('misskey-account は accountId 必須', () => {
    expect(
      checkWidgetCapabilities(['misskey-account'], { accountId: null }).ok,
    ).toBe(false)
    expect(
      checkWidgetCapabilities(['misskey-account'], { accountId: 'a1' }).ok,
    ).toBe(true)
  })

  it('未知 capability は「未対応の機能」として非互換', () => {
    const result = checkWidgetCapabilities(['future-thing'], {
      accountId: 'a1',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('未対応の機能: future-thing')
  })
})

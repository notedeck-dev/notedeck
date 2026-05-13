import { describe, expect, it } from 'vitest'
import {
  NAVBAR_BUILTIN_CAPABILITIES,
  navbarListCapability,
  navbarResetCapability,
  navbarSetCapability,
} from './navbar'

// Note: execute は useDeckStore (Pinia) を呼ぶため unit 環境では走らない。
// capability 定義と requiresConfirmation 関数の出力のみ検証する。

describe('navbar capabilities — declaration', () => {
  it('navbar.list: no permission, aiTool true, cheap', () => {
    expect(navbarListCapability.id).toBe('navbar.list')
    expect(navbarListCapability.permissions).toEqual([])
    expect(navbarListCapability.aiTool).toBe(true)
    expect(navbarListCapability.signature?.cheap).toBe(true)
    expect(navbarListCapability.signature?.returns?.type).toBe('array')
  })

  it('navbar.set: navbar.write permission, confirmation function, requires items', () => {
    expect(navbarSetCapability.id).toBe('navbar.set')
    expect(navbarSetCapability.permissions).toEqual(['navbar.write'])
    expect(typeof navbarSetCapability.requiresConfirmation).toBe('function')
    expect(navbarSetCapability.signature?.params?.items?.optional).not.toBe(
      true,
    )
  })

  it('navbar.set rejects non-array items / unknown types / non-object entries', () => {
    expect(() => navbarSetCapability.execute({ items: 'not array' })).toThrow(
      /items must be an array/,
    )
    expect(() => navbarSetCapability.execute({ items: [null] })).toThrow(
      /not an object/,
    )
    expect(() =>
      navbarSetCapability.execute({ items: [{ type: 'unknown' }] }),
    ).toThrow(/unknown type "unknown"/)
    expect(() => navbarSetCapability.execute({ items: [{}] })).toThrow(
      /missing string "type"/,
    )
  })

  it('navbar.reset: navbar.write permission, no params', () => {
    expect(navbarResetCapability.id).toBe('navbar.reset')
    expect(navbarResetCapability.permissions).toEqual(['navbar.write'])
    expect(typeof navbarResetCapability.requiresConfirmation).toBe('function')
    expect(Object.keys(navbarResetCapability.signature?.params ?? {})).toEqual(
      [],
    )
  })
})

describe('navbar.set confirmation', () => {
  it('shows item count and JSON code', async () => {
    const confirm = navbarSetCapability.requiresConfirmation
    if (typeof confirm !== 'function') throw new Error('expected function')
    const opts = await confirm({
      items: [
        { type: 'notifications', accountId: null },
        { type: 'divider' },
        { type: 'ai', accountId: null },
      ],
    })
    expect(opts?.type).toBe('warning')
    expect(opts?.codeLanguage).toBe('json')
    expect(opts?.message).toContain('3 項目')
  })
})

describe('NAVBAR_BUILTIN_CAPABILITIES', () => {
  it('contains list / set / reset', () => {
    const ids = NAVBAR_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['navbar.list', 'navbar.reset', 'navbar.set'])
  })

  it('all capabilities are exposed to AI (aiTool: true)', () => {
    for (const cap of NAVBAR_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} should be aiTool`).toBe(true)
    }
  })
})

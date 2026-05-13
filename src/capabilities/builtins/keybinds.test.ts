import { describe, expect, it } from 'vitest'
import {
  KEYBINDS_BUILTIN_CAPABILITIES,
  keybindsListCapability,
  keybindsResetAllCapability,
  keybindsResetCapability,
  keybindsSetCapability,
} from './keybinds'

// Note: execute は useKeybindsStore (Pinia) を呼ぶため unit 環境では走らない。
// capability 定義と引数バリデーションのみ検証する。

describe('keybinds capabilities — declaration', () => {
  it('keybinds.list: no permission, aiTool true, cheap', () => {
    expect(keybindsListCapability.id).toBe('keybinds.list')
    expect(keybindsListCapability.permissions).toEqual([])
    expect(keybindsListCapability.signature?.cheap).toBe(true)
    expect(keybindsListCapability.signature?.returns?.type).toBe('array')
  })

  it('keybinds.set: write permission, confirmation, requires commandId + shortcuts', () => {
    expect(keybindsSetCapability.id).toBe('keybinds.set')
    expect(keybindsSetCapability.permissions).toEqual(['keybinds.write'])
    expect(typeof keybindsSetCapability.requiresConfirmation).toBe('function')
    expect(() => keybindsSetCapability.execute({ shortcuts: [] })).toThrow(
      /commandId is required/,
    )
    expect(() =>
      keybindsSetCapability.execute({ commandId: 'x', shortcuts: 'no' }),
    ).toThrow(/shortcuts must be an array/)
  })

  it('keybinds.set rejects invalid shortcut entries', () => {
    expect(() =>
      keybindsSetCapability.execute({
        commandId: 'x',
        shortcuts: [{ scope: 'global' }],
      }),
    ).toThrow(/missing string "key"/)
    expect(() =>
      keybindsSetCapability.execute({
        commandId: 'x',
        shortcuts: [{ key: 'k', scope: 'invalid' }],
      }),
    ).toThrow(/scope must be/)
    expect(() =>
      keybindsSetCapability.execute({
        commandId: 'x',
        shortcuts: [null],
      }),
    ).toThrow(/not an object/)
  })

  it('keybinds.reset: write permission, requires commandId', () => {
    expect(keybindsResetCapability.id).toBe('keybinds.reset')
    expect(keybindsResetCapability.permissions).toEqual(['keybinds.write'])
    expect(typeof keybindsResetCapability.requiresConfirmation).toBe('function')
    expect(() => keybindsResetCapability.execute({})).toThrow(
      /commandId is required/,
    )
  })

  it('keybinds.resetAll: write permission, no params', () => {
    expect(keybindsResetAllCapability.id).toBe('keybinds.resetAll')
    expect(keybindsResetAllCapability.permissions).toEqual(['keybinds.write'])
    expect(typeof keybindsResetAllCapability.requiresConfirmation).toBe(
      'function',
    )
    expect(
      Object.keys(keybindsResetAllCapability.signature?.params ?? {}),
    ).toEqual([])
  })
})

describe('KEYBINDS_BUILTIN_CAPABILITIES', () => {
  it('contains list / set / reset / resetAll', () => {
    const ids = KEYBINDS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'keybinds.list',
      'keybinds.reset',
      'keybinds.resetAll',
      'keybinds.set',
    ])
  })

  it('all capabilities are exposed to AI (aiTool: true)', () => {
    for (const cap of KEYBINDS_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} should be aiTool`).toBe(true)
    }
  })
})

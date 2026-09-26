import { describe, expect, it } from 'vitest'
import {
  KEYBINDS_BUILTIN_CAPABILITIES,
  keybindsListCapability,
  keybindsResetAllCapability,
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

import { describe, expect, it } from 'vitest'
import { WINDOW_SIZES } from '@/stores/windows'
import {
  WINDOWS_BUILTIN_CAPABILITIES,
  windowsCloseAllCapability,
  windowsCloseCapability,
  windowsFocusCapability,
  windowsListCapability,
  windowsOpenCapability,
} from './windows'

// Note: execute は useWindowsStore (Pinia) を呼ぶため unit 環境では走らない。
// capability 定義と引数バリデーション (= type / id 必須・enum 検証) のみ
// 検証する。

describe('windows capabilities — declaration', () => {
  it('windows.list: no permission, aiTool, cheap, array return', () => {
    expect(windowsListCapability.id).toBe('windows.list')
    expect(windowsListCapability.permissions).toEqual([])
    expect(windowsListCapability.signature?.cheap).toBe(true)
    expect(windowsListCapability.signature?.returns?.type).toBe('array')
  })

  it('windows.open: no permission, no confirmation, validates type', () => {
    expect(windowsOpenCapability.id).toBe('windows.open')
    expect(windowsOpenCapability.permissions).toEqual([])
    expect(windowsOpenCapability.requiresConfirmation).not.toBe(true)
    expect(windowsOpenCapability.signature?.params?.type?.optional).not.toBe(
      true,
    )
    expect(windowsOpenCapability.signature?.params?.props?.optional).toBe(true)
    expect(() => windowsOpenCapability.execute({})).toThrow(/type is required/)
    expect(() =>
      windowsOpenCapability.execute({ type: 'no-such-window' }),
    ).toThrow(/unknown window type/)
  })

  it('windows.open: enum lists valid WindowType keys', () => {
    const enumList = windowsOpenCapability.signature?.params?.type?.enum
    expect(enumList).toContain('note-detail')
    expect(enumList).toContain('aiSettings')
    expect(enumList).toContain('cssEditor')
    expect(enumList).toContain('navEditor')
  })

  it('windows.close: no permission, no confirmation, requires id', () => {
    expect(windowsCloseCapability.id).toBe('windows.close')
    expect(windowsCloseCapability.permissions).toEqual([])
    expect(windowsCloseCapability.requiresConfirmation).not.toBe(true)
    expect(() => windowsCloseCapability.execute({})).toThrow(/id is required/)
  })

  it('windows.focus: no permission, no confirmation, requires id', () => {
    expect(windowsFocusCapability.id).toBe('windows.focus')
    expect(windowsFocusCapability.permissions).toEqual([])
    expect(windowsFocusCapability.requiresConfirmation).not.toBe(true)
    expect(() => windowsFocusCapability.execute({})).toThrow(/id is required/)
  })

  it('windows.closeAll: no permission, warning confirmation, no params', () => {
    expect(windowsCloseAllCapability.id).toBe('windows.closeAll')
    expect(windowsCloseAllCapability.permissions).toEqual([])
    expect(typeof windowsCloseAllCapability.requiresConfirmation).toBe(
      'function',
    )
    expect(
      Object.keys(windowsCloseAllCapability.signature?.params ?? {}),
    ).toEqual([])
  })
})

describe('WINDOWS_BUILTIN_CAPABILITIES', () => {
  it('contains list / open / close / focus / closeAll', () => {
    const ids = WINDOWS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'windows.close',
      'windows.closeAll',
      'windows.focus',
      'windows.list',
      'windows.open',
    ])
  })

  it('all capabilities are exposed to AI (aiTool: true)', () => {
    for (const cap of WINDOWS_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} should be aiTool`).toBe(true)
    }
  })
})

describe('valid な WindowType はレジストリ相当 (WINDOW_SIZES) 由来 (#794 W2)', () => {
  const enumTypes = () =>
    (windowsOpenCapability.signature?.params?.type?.enum ??
      []) as readonly string[]

  it('全 WindowType が enum に載る', () => {
    expect([...enumTypes()].sort()).toEqual(Object.keys(WINDOW_SIZES).sort())
  })

  it('手書き時代に漏れていた 4 種も開ける', () => {
    for (const t of [
      'drive-file-detail',
      'connections',
      'connectionEdit',
      'tutorial',
    ]) {
      expect(enumTypes()).toContain(t)
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  collectOsGlobalBindings,
  toAccelerator,
} from '@/services/osGlobalShortcuts'

describe('toAccelerator', () => {
  it('修飾キーと英字を tauri の accelerator に変換する', () => {
    expect(
      toAccelerator({ key: 'b', ctrl: true, shift: true, scope: 'os-global' }),
    ).toBe('Control+Shift+B')
    expect(
      toAccelerator({ key: 'n', ctrl: true, alt: true, scope: 'os-global' }),
    ).toBe('Control+Alt+N')
  })

  it('数字 / 記号 / 名前つきキーを tauri の名前に写す', () => {
    expect(
      toAccelerator({ key: '1', ctrl: true, alt: true, scope: 'os-global' }),
    ).toBe('Control+Alt+Digit1')
    expect(toAccelerator({ key: ',', ctrl: true, scope: 'os-global' })).toBe(
      'Control+Comma',
    )
    expect(toAccelerator({ key: '\\', ctrl: true, scope: 'os-global' })).toBe(
      'Control+Backslash',
    )
    expect(toAccelerator({ key: ' ', ctrl: true, scope: 'os-global' })).toBe(
      'Control+Space',
    )
    expect(toAccelerator({ key: 'F5', alt: true, scope: 'os-global' })).toBe(
      'Alt+F5',
    )
    expect(
      toAccelerator({ key: 'ArrowUp', ctrl: true, scope: 'os-global' }),
    ).toBe('Control+ArrowUp')
  })

  it('修飾キーの無い OS ホットキーは作らない (どのアプリでも奪ってしまう)', () => {
    expect(toAccelerator({ key: 'p', scope: 'os-global' })).toBeNull()
  })

  it('写せないキーは null', () => {
    expect(
      toAccelerator({ key: 'Dead', ctrl: true, scope: 'os-global' }),
    ).toBeNull()
  })
})

describe('collectOsGlobalBindings', () => {
  it('os-global のショートカットだけを command id と accelerator の組にする', () => {
    const bindings = collectOsGlobalBindings([
      {
        id: 'boss-key',
        shortcuts: [
          { key: 'b', ctrl: true, shift: true, scope: 'os-global' },
          { key: 'h', scope: 'body' },
        ],
      },
      {
        id: 'compose',
        shortcuts: [{ key: 'n', ctrl: true, shift: true, scope: 'global' }],
      },
      {
        id: 'quick-note',
        shortcuts: [{ key: 'n', ctrl: true, alt: true, scope: 'os-global' }],
      },
    ])
    expect(bindings).toEqual([
      { commandId: 'boss-key', accelerator: 'Control+Shift+B' },
      { commandId: 'quick-note', accelerator: 'Control+Alt+N' },
    ])
  })

  it('同じ accelerator が 2 つの command にあれば先勝ちで 1 つに畳み、重複を返す', () => {
    const bindings = collectOsGlobalBindings([
      {
        id: 'a',
        shortcuts: [{ key: 'x', ctrl: true, alt: true, scope: 'os-global' }],
      },
      {
        id: 'b',
        shortcuts: [{ key: 'X', ctrl: true, alt: true, scope: 'os-global' }],
      },
    ])
    expect(bindings).toEqual([{ commandId: 'a', accelerator: 'Control+Alt+X' }])
  })
})

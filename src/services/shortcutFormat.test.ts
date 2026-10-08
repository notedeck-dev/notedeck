import { describe, expect, it } from 'vitest'
import { formatShortcut } from './shortcutFormat'

describe('formatShortcut', () => {
  it('mac は記号を連結する', () => {
    expect(
      formatShortcut(
        { key: 'k', ctrl: true, shift: true, alt: false, scope: 'global' },
        true,
      ),
    ).toBe('⌘⇧K')
  })

  it('mac 以外は Ctrl / Shift / Alt を + で繋ぐ', () => {
    expect(
      formatShortcut(
        { key: 'k', ctrl: true, shift: false, alt: true, scope: 'global' },
        false,
      ),
    ).toBe('Ctrl+Alt+K')
  })

  it('特殊キーは短い表記に置き換え、未知のキーはそのまま', () => {
    expect(formatShortcut({ key: 'Escape', scope: 'body' }, false)).toBe('Esc')
    expect(formatShortcut({ key: 'ArrowUp', scope: 'body' }, false)).toBe('↑')
    expect(formatShortcut({ key: 'F5', scope: 'body' }, false)).toBe('F5')
  })
})

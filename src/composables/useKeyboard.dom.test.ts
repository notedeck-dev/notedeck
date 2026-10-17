import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCommandStore } from '@/commands/registry'
import { useKeybindsStore } from '@/stores/keybinds'
import { useKeyboard } from './useKeyboard'

function press(init: KeyboardEventInit) {
  document.body.focus()
  document.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  )
}

describe('useKeyboard とプラグイン command のキーバインド (#1243)', () => {
  let cleanup: () => void

  beforeEach(() => {
    setActivePinia(createPinia())
    const kb = useKeyboard()
    kb.init()
    cleanup = kb.cleanup
  })

  afterEach(() => {
    cleanup()
  })

  it('Nd:register_command 相当 (shortcuts 空) の command に keybinds の上書きが届く', () => {
    const execute = vi.fn()
    useCommandStore().register({
      id: 'hotkey-react:hotkey-react-1',
      label: 'React',
      icon: 'heart',
      category: 'general',
      shortcuts: [],
      execute,
    })
    press({ key: 'r', ctrlKey: true, shiftKey: true })
    expect(execute).not.toHaveBeenCalled()

    useKeybindsStore().setShortcuts('hotkey-react:hotkey-react-1', [
      { key: 'r', ctrl: true, shift: true, scope: 'global' },
    ])
    press({ key: 'r', ctrlKey: true, shiftKey: true })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('組込 command の上書きも登録し直さずに効く', () => {
    const execute = vi.fn()
    const kb = useKeybindsStore()
    useCommandStore().register({
      id: 'command-palette',
      label: 'Palette',
      icon: 'command',
      category: 'general',
      shortcuts: kb.getShortcuts('command-palette'),
      execute,
    })
    kb.setShortcuts('command-palette', [{ key: 'F9', scope: 'global' }])
    press({ key: 'F9' })
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

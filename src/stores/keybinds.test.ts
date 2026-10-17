import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useKeybindsStore } from './keybinds'

describe('useKeybindsStore.resolveShortcuts (#1243)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('組込 command は既定ファイルの値 (登録時の写しではなく今の値)', () => {
    const store = useKeybindsStore()
    const resolved = store.resolveShortcuts({
      id: 'command-palette',
      shortcuts: [],
    })
    expect(resolved).toEqual(store.getDefaultShortcuts('command-palette'))
    expect(resolved.length).toBeGreaterThan(0)
  })

  it('上書きがあれば組込でもプラグインでも上書きが勝つ', () => {
    const store = useKeybindsStore()
    const custom = [
      { key: 'r', ctrl: true, shift: true, scope: 'global' as const },
    ]
    store.setShortcuts('command-palette', custom)
    store.setShortcuts('hotkey-react:hotkey-react-1', custom)
    expect(
      store.resolveShortcuts({ id: 'command-palette', shortcuts: [] }),
    ).toEqual(custom)
    expect(
      store.resolveShortcuts({
        id: 'hotkey-react:hotkey-react-1',
        shortcuts: [],
      }),
    ).toEqual(custom)
  })

  it('既定ファイルに無く上書きも無い command は自分の宣言のまま', () => {
    const store = useKeybindsStore()
    const own = [{ key: 'q', alt: true, scope: 'global' as const }]
    expect(
      store.resolveShortcuts({
        id: 'hotkey-react:hotkey-react-1',
        shortcuts: own,
      }),
    ).toBe(own)
    expect(
      store.resolveShortcuts({ id: 'local:abc:cmd', shortcuts: [] }),
    ).toEqual([])
  })

  it('上書きを既定に戻すと宣言に戻る', () => {
    const store = useKeybindsStore()
    const cmd = { id: 'hotkey-react:hotkey-react-1', shortcuts: [] }
    store.setShortcuts(cmd.id, [{ key: 'r', ctrl: true, scope: 'global' }])
    store.resetToDefault(cmd.id)
    expect(store.resolveShortcuts(cmd)).toEqual([])
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  readKeybinds: vi.fn(async () => ''),
  writeKeybinds: vi.fn(async () => undefined),
}))

type RootHandler = (change: { name: string }) => Promise<void> | void
const rootHandlers: RootHandler[] = []
vi.mock('@/services/settingsFileSync', () => ({
  registerSettingsFileHandler: (_kind: string, handler: RootHandler) => {
    rootHandlers.push(handler)
  },
}))

import { PERSIST_DEBOUNCE_MS } from '@/constants/persist'
import { useKeybindsStore } from '@/stores/keybinds'
import { readKeybinds, writeKeybinds } from '@/utils/settingsFs'

// 利用者がコメントを書いた、JSON5.stringify とは違う形のファイル
const FILE = "// mine\n{ 'note.create': [{ key: 'n' }] }\n"

async function flush(): Promise<void> {
  // init の await 連鎖を進めてから debounce を過ぎさせる
  for (let i = 0; i < 5; i++) await Promise.resolve()
  vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2)
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('useKeybindsStore の書込 (#1333 §2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    rootHandlers.length = 0
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('起動時に読んだだけでは keybinds.json5 を書き戻さない', async () => {
    vi.mocked(readKeybinds).mockResolvedValue(FILE)
    const store = useKeybindsStore()
    store.init()
    await flush()
    expect(writeKeybinds).not.toHaveBeenCalled()
    expect(store.getShortcuts('note.create')).toEqual([{ key: 'n' }])
  })

  it('notemaid が書いた後の読み直しでも書き戻さない', async () => {
    vi.mocked(readKeybinds).mockResolvedValue('')
    const store = useKeybindsStore()
    store.init()
    await flush()
    vi.mocked(readKeybinds).mockResolvedValue(FILE)
    expect(rootHandlers).toHaveLength(1)
    await rootHandlers[0]?.({ name: 'keybinds.json5' })
    await flush()
    expect(writeKeybinds).not.toHaveBeenCalled()
    expect(store.getShortcuts('note.create')).toEqual([{ key: 'n' }])
  })

  it('利用者の変更は標準の整形 (末尾改行つき) で書く', async () => {
    vi.mocked(readKeybinds).mockResolvedValue(FILE)
    const store = useKeybindsStore()
    store.init()
    await flush()
    store.setShortcuts('note.create', [{ key: 'm', scope: 'global' }])
    await flush()
    expect(writeKeybinds).toHaveBeenCalledTimes(1)
    expect(writeKeybinds).toHaveBeenCalledWith(
      "{\n  'note.create': [\n    {\n      key: 'm',\n      scope: 'global',\n    },\n  ],\n}\n",
    )
  })
})

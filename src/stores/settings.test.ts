import JSON5 from 'json5'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  parseSettings,
} from '@/settings/schema'

// `@/stores/settings` は isTauri と commands を import する。テストでは両方モック
// して settings.json の read/write を制御可能にする。
vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
}))

vi.mock('@/utils/tauriInvoke', () => ({
  commands: {
    readNotedeckJson: vi.fn(),
    writeNotedeckJson: vi.fn(),
  },
  unwrap: (result: { status: string; data?: unknown; error?: unknown }) => {
    if (result.status === 'ok') return result.data
    throw result.error
  },
}))

import { useSettingsStore } from '@/stores/settings'
import { commands } from '@/utils/tauriInvoke'

describe('parseSettings', () => {
  it('returns defaults for non-object input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('string')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('merges known keys on top of defaults', () => {
    const parsed = parseSettings({
      'theme.manual': 'dark',
      'modes.realtime': false,
    })
    expect(parsed['theme.manual']).toBe('dark')
    expect(parsed['modes.realtime']).toBe(false)
    // Default-preserved key
    expect(parsed['modes.offline']).toBe(false)
  })

  it('preserves unknown keys for forward compatibility', () => {
    const parsed = parseSettings({
      'future.unknownKey': 'something',
      'modes.realtime': true,
    }) as unknown as Record<string, unknown>
    expect(parsed['future.unknownKey']).toBe('something')
  })

  it('normalizes missing _schema to current version', () => {
    const parsed = parseSettings({ 'modes.realtime': true })
    expect(parsed._schema).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('keeps existing _schema value when present', () => {
    const parsed = parseSettings({ _schema: 42 })
    expect(parsed._schema).toBe(42)
  })
})

describe('useSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('load() uses defaults when file is empty (first run)', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: '',
    } as never)

    const store = useSettingsStore()
    await store.load()

    expect(store.initialized).toBe(true)
    expect(store.get('modes.realtime')).toBe(DEFAULT_SETTINGS['modes.realtime'])
    expect(store.get('modes.offline')).toBe(DEFAULT_SETTINGS['modes.offline'])
  })

  it('load() parses existing settings.json content', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: JSON.stringify({
        _schema: 1,
        'modes.realtime': false,
        'theme.manual': 'dark',
      }),
    } as never)

    const store = useSettingsStore()
    await store.load()

    expect(store.get('modes.realtime')).toBe(false)
    expect(store.get('theme.manual')).toBe('dark')
  })

  it('load() falls back to defaults on invalid JSON', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: 'not valid json {',
    } as never)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      // silence expected warning during test
    })
    const store = useSettingsStore()
    await store.load()

    expect(store.initialized).toBe(true)
    expect(store.get('modes.realtime')).toBe(DEFAULT_SETTINGS['modes.realtime'])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('load() is idempotent — second call is a no-op', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: '',
    } as never)

    const store = useSettingsStore()
    await store.load()
    await store.load()

    expect(commands.readNotedeckJson).toHaveBeenCalledTimes(1)
  })

  it('set() updates the value reactively', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: '',
    } as never)
    vi.mocked(commands.writeNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: null,
    } as never)

    const store = useSettingsStore()
    await store.load()

    store.set('modes.realtime', false)
    expect(store.get('modes.realtime')).toBe(false)

    store.set('theme.manual', 'light')
    expect(store.get('theme.manual')).toBe('light')
  })

  it('set() schedules a debounced persist after 300ms', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: '',
    } as never)
    vi.mocked(commands.writeNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: null,
    } as never)

    const store = useSettingsStore()
    await store.load()

    store.set('modes.realtime', false)
    // Not yet written (debounce pending)
    expect(commands.writeNotedeckJson).not.toHaveBeenCalled()

    // Advance past the debounce window
    await vi.advanceTimersByTimeAsync(300)
    expect(commands.writeNotedeckJson).toHaveBeenCalledTimes(1)

    // Verify the written content contains the updated value
    const writeCall = vi.mocked(commands.writeNotedeckJson).mock.calls[0]
    const content = writeCall?.[0] as string
    const parsed = JSON5.parse(content)
    expect(parsed['modes.realtime']).toBe(false)
    expect(parsed._schema).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('multiple set() calls within the debounce window collapse into one write', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: '',
    } as never)
    vi.mocked(commands.writeNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: null,
    } as never)

    const store = useSettingsStore()
    await store.load()

    store.set('modes.realtime', false)
    store.set('modes.realtime', true)
    store.set('theme.manual', 'dark')
    await vi.advanceTimersByTimeAsync(300)

    expect(commands.writeNotedeckJson).toHaveBeenCalledTimes(1)
  })

  it('空ファイル (新規インストール) は読み込み失敗として扱わない', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: '',
    } as never)

    const store = useSettingsStore()
    await store.load()

    expect(store.loadFailed).toBe(false)
  })

  it('パース失敗時は loadFailed を立てる', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: 'not valid json {',
    } as never)
    vi.spyOn(console, 'warn').mockImplementation(() => {
      // silence expected warning during test
    })

    const store = useSettingsStore()
    await store.load()

    expect(store.loadFailed).toBe(true)
  })

  it('読み込み失敗後は書き戻さない — defaults による上書き消失を防ぐ', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: 'not valid json {',
    } as never)
    vi.mocked(commands.writeNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: null,
    } as never)
    vi.spyOn(console, 'warn').mockImplementation(() => {
      // silence expected warning during test
    })

    const store = useSettingsStore()
    await store.load()

    // メモリ上の変更は効くが、ファイルには書かない
    store.set('modes.realtime', false)
    expect(store.get('modes.realtime')).toBe(false)
    await vi.advanceTimersByTimeAsync(300)
    expect(commands.writeNotedeckJson).not.toHaveBeenCalled()

    await store.flush()
    expect(commands.writeNotedeckJson).not.toHaveBeenCalled()
  })

  it('flush() immediately persists pending changes', async () => {
    vi.mocked(commands.readNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: '',
    } as never)
    vi.mocked(commands.writeNotedeckJson).mockResolvedValue({
      status: 'ok',
      data: null,
    } as never)

    const store = useSettingsStore()
    await store.load()

    store.set('modes.realtime', false)
    expect(commands.writeNotedeckJson).not.toHaveBeenCalled()

    await store.flush()
    expect(commands.writeNotedeckJson).toHaveBeenCalledTimes(1)
  })
})

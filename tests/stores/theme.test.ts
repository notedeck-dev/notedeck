// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@/stores/accounts'
import { useAccountsStore } from '@/stores/accounts'
import { useThemeStore } from '@/stores/theme'
import { DARK_THEME, LIGHT_THEME } from '@/theme/builtinThemes'

function makeAccount(id: string): Account {
  return {
    id,
    host: 'example.com',
    userId: `u-${id}`,
    username: id,
    displayName: id,
    avatarUrl: null,
    software: 'misskey',
  }
}

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiFetchAccountTheme: vi.fn(async () => ({ status: 'ok', data: {} })),
      apiSetRegistryValue: vi.fn(async () => ({ status: 'ok', data: null })),
      apiDeleteRegistryValue: vi.fn(async () => ({ status: 'ok', data: null })),
    },
  }
})

import { commands } from '@/utils/tauriInvoke'

const mockFetchTheme = vi.mocked(commands.apiFetchAccountTheme)

describe('theme store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-color-scheme')
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('init() applies builtin dark theme by default', () => {
    const store = useThemeStore()
    store.init()
    expect(store.currentSource?.kind).toBe('builtin-dark')
    expect(document.documentElement.style.getPropertyValue('--nd-bg')).not.toBe(
      '',
    )
  })

  it('init() restores compiled CSS then applies OS theme', () => {
    const compiled = { bg: '#fafafa', fg: '#5f5f5f' }
    localStorage.setItem('nd-theme-compiled', JSON.stringify(compiled))

    const store = useThemeStore()
    store.init()

    // OS preference is dark (mocked), so builtin-dark is applied
    expect(store.currentSource?.kind).toBe('builtin-dark')
  })

  it('init() resets to builtin dark when localStorage has server theme', () => {
    const serverSource = {
      kind: 'server-dark' as const,
      host: 'yami.ski',
      theme: DARK_THEME,
    }
    localStorage.setItem('nd-theme-source', JSON.stringify(serverSource))
    localStorage.setItem('nd-theme-compiled', JSON.stringify({ bg: '#123456' }))

    const store = useThemeStore()
    store.init()

    expect(store.currentSource?.kind).toBe('builtin-dark')
    expect(document.documentElement.style.getPropertyValue('--nd-bg')).not.toBe(
      '#123456',
    )
  })

  it('applySource() compiles and applies a theme', () => {
    const store = useThemeStore()
    store.init()

    store.applySource({ kind: 'builtin-light', theme: LIGHT_THEME })

    expect(store.currentSource?.kind).toBe('builtin-light')
    const bg = document.documentElement.style.getPropertyValue('--nd-bg')
    expect(bg).not.toBe('')
    expect(localStorage.getItem('nd-theme-compiled')).not.toBeNull()
  })

  it('applySource() switches between dark and light', () => {
    const store = useThemeStore()
    store.init()

    store.applySource({ kind: 'builtin-dark', theme: DARK_THEME })
    const darkBg = document.documentElement.style.getPropertyValue('--nd-bg')

    store.applySource({ kind: 'builtin-light', theme: LIGHT_THEME })
    const lightBg = document.documentElement.style.getPropertyValue('--nd-bg')

    expect(darkBg).not.toBe(lightBg)
  })

  it('applySource() with server theme uses correct base', () => {
    const store = useThemeStore()
    store.init()

    const serverDark = {
      id: 'server-dark-test',
      name: 'Server Dark',
      base: 'dark' as const,
      props: { accent: '#ff0000' },
    }
    store.applySource({
      kind: 'server-dark',
      host: 'test.host',
      theme: serverDark,
    })

    expect(store.currentSource?.kind).toBe('server-dark')
    const accent =
      document.documentElement.style.getPropertyValue('--nd-accent')
    expect(accent).toBe('#ff0000')
    const bg = document.documentElement.style.getPropertyValue('--nd-bg')
    expect(bg).not.toBe('')
  })

  // --- fetchAccountTheme (meta only; registry sync は責任分離で廃止) ---

  it('fetchAccountTheme() stores admin meta defaults (dark + light)', async () => {
    mockFetchTheme.mockResolvedValue({
      status: 'ok',
      data: {
        metaDark: JSON.stringify({ name: 'D', props: { bg: '#000' } }),
        metaLight: JSON.stringify({ name: 'L', props: { bg: '#fff' } }),
      },
    })

    const store = useThemeStore()
    await store.fetchAccountTheme('acc-3')

    const cached = store.getAccountThemes('acc-3')
    expect(cached?.metaDark?.props.bg).toBe('#000')
    expect(cached?.metaLight?.props.bg).toBe('#fff')
    // registry sync は使わないので dark/light は per-column 適用 (apply) 経由のみで埋まる
    expect(cached?.dark).toBeUndefined()
    expect(cached?.light).toBeUndefined()
  })

  it('fetchAccountTheme() handles servers without meta defaults', async () => {
    mockFetchTheme.mockResolvedValue({ status: 'ok', data: {} })

    const store = useThemeStore()
    await store.fetchAccountTheme('acc-empty')

    const cached = store.getAccountThemes('acc-empty')
    expect(cached?.metaDark).toBeUndefined()
    expect(cached?.metaLight).toBeUndefined()
  })

  it('fetchAccountTheme() does not re-fetch for cached account', async () => {
    mockFetchTheme.mockResolvedValue({
      status: 'ok',
      data: { metaDark: JSON.stringify({ name: 'D', props: {} }) },
    })

    const store = useThemeStore()
    await store.fetchAccountTheme('acc-cache')
    await store.fetchAccountTheme('acc-cache')

    expect(mockFetchTheme).toHaveBeenCalledTimes(1)
  })

  it('fetchAccountTheme() handles errors gracefully', async () => {
    mockFetchTheme.mockResolvedValue({
      status: 'error',
      error: { code: 'Network', message: 'Network error' },
    })

    const store = useThemeStore()
    await store.fetchAccountTheme('acc-offline')

    expect(store.getAccountThemes('acc-offline')).toBeNull()
  })

  // --- getCompiledForAccount ---

  it('getCompiledForAccount() returns null for unknown account', () => {
    const store = useThemeStore()
    expect(store.getCompiledForAccount('unknown-acc')).toBeNull()
  })

  it('getCompiledForAccount() compiles and caches theme', async () => {
    mockFetchTheme.mockResolvedValue({
      status: 'ok',
      data: {
        metaDark: JSON.stringify({
          name: 'Custom',
          props: { accent: '#ff6600', bg: '#1a1a2e' },
        }),
      },
    })

    const store = useThemeStore()
    store.init()
    await store.fetchAccountTheme('acc-compile')

    const compiled = store.getCompiledForAccount('acc-compile')
    expect(compiled).not.toBeNull()
    expect(compiled?.accent).toBe('#ff6600')
    expect(compiled?.bg).toBe('#1a1a2e')
    expect(compiled?.fg).toBeDefined()

    // Second call should return cached result (same reference)
    const compiled2 = store.getCompiledForAccount('acc-compile')
    expect(compiled2).toBe(compiled)
  })

  it('getCompiledForAccount() uses light theme when base is light', async () => {
    mockFetchTheme.mockResolvedValue({
      status: 'ok',
      data: {
        metaDark: JSON.stringify({ name: 'D', props: { bg: '#111' } }),
        metaLight: JSON.stringify({ name: 'L', props: { bg: '#eee' } }),
      },
    })

    const store = useThemeStore()
    store.init()
    store.applySource({ kind: 'builtin-light', theme: LIGHT_THEME })
    await store.fetchAccountTheme('acc-light')

    const compiled = store.getCompiledForAccount('acc-light')
    expect(compiled).not.toBeNull()
    expect(compiled?.bg).toBe('#eee')
  })

  it('getCompiledForAccount() returns null when current mode theme is missing (no cross-mode fallback)', async () => {
    // dark モードで適用するテーマしか持たないアカウント。light モードでは
    // 該当テーマが無いので null を返す (デッキ全体の builtin にフォールバック)。
    // 旧実装は cross-mode で dark を当てていたが、dark/light が混在表示される
    // 混乱を避けるため mode strict 化 (#339)。
    mockFetchTheme.mockResolvedValue({
      status: 'ok',
      data: { metaDark: JSON.stringify({ name: 'D', props: { bg: '#222' } }) },
    })

    const store = useThemeStore()
    store.init()
    store.applySource({ kind: 'builtin-light', theme: LIGHT_THEME })
    await store.fetchAccountTheme('acc-fb')

    const compiled = store.getCompiledForAccount('acc-fb')
    expect(compiled).toBeNull()
  })

  it('applySource() clears compiled cache so columns recompile', async () => {
    mockFetchTheme.mockResolvedValue({
      status: 'ok',
      data: {
        metaDark: JSON.stringify({ name: 'D', props: { bg: '#111' } }),
        metaLight: JSON.stringify({ name: 'L', props: { bg: '#eee' } }),
      },
    })

    const store = useThemeStore()
    store.init()
    await store.fetchAccountTheme('acc-switch')

    const dark = store.getCompiledForAccount('acc-switch')
    expect(dark?.bg).toBe('#111')

    store.applySource({ kind: 'builtin-light', theme: LIGHT_THEME })
    const light = store.getCompiledForAccount('acc-switch')
    expect(light?.bg).toBe('#eee')
    expect(light).not.toBe(dark)
  })

  // --- per-account isolation ---

  it('different accounts can have different meta themes', async () => {
    let callCount = 0
    mockFetchTheme.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return {
          status: 'ok',
          data: {
            metaDark: JSON.stringify({
              name: 'A-Dark',
              props: { accent: '#ff0000' },
            }),
          },
        }
      }
      return {
        status: 'ok',
        data: {
          metaDark: JSON.stringify({
            name: 'B-Dark',
            props: { accent: '#0000ff' },
          }),
        },
      }
    })

    const store = useThemeStore()
    store.init()
    await store.fetchAccountTheme('acc-a')
    await store.fetchAccountTheme('acc-b')

    const a = store.getCompiledForAccount('acc-a')
    const b = store.getCompiledForAccount('acc-b')
    expect(a?.accent).toBe('#ff0000')
    expect(b?.accent).toBe('#0000ff')
  })

  // --- per-account theme apply / clear (NoteDeck 内部 cache のみ) ---
  // registry write/remove は本家責務 (デバイス local の darkTheme は同期されない
  // 設計) なので NoteDeck からは介入しない。apply/clear は accountThemeCache
  // (localStorage persist) の更新のみ行う。

  it('applyAccountTheme() updates the cache without calling registry', async () => {
    const accountsStore = useAccountsStore()
    const themeStore = useThemeStore()
    accountsStore.addAccount(makeAccount('acc-x'))

    const theme = {
      id: 'custom-1',
      name: 'X',
      base: 'dark' as const,
      props: { bg: '#123456', accent: '#abcdef' },
    }
    await themeStore.applyAccountTheme(theme, 'dark', 'acc-x')

    const cached = themeStore.getAccountThemes('acc-x')
    expect(cached?.dark?.props.bg).toBe('#123456')
    expect(cached?.dark?.props.accent).toBe('#abcdef')
    expect(cached?.dark?.id).toBe('account-dark-acc-x')

    expect(commands.apiSetRegistryValue).not.toHaveBeenCalled()
    expect(commands.apiDeleteRegistryValue).not.toHaveBeenCalled()
  })

  it('applyAccountTheme() does not override the deck-wide theme', async () => {
    const accountsStore = useAccountsStore()
    const themeStore = useThemeStore()
    accountsStore.addAccount(makeAccount('acc-y'))
    themeStore.init()

    themeStore.selectTheme(null, 'dark')
    const beforeKind = themeStore.currentSource?.kind

    const theme = {
      id: 'orange',
      name: 'Orange',
      base: 'dark' as const,
      props: { accent: '#ff6600', bg: '#202020' },
    }
    await themeStore.applyAccountTheme(theme, 'dark', 'acc-y')

    expect(themeStore.currentSource?.kind).toBe(beforeKind)
    const compiled = themeStore.getCompiledForAccount('acc-y')
    expect(compiled?.accent).toBe('#ff6600')
  })

  it('clearAccountTheme() removes cache entry without calling registry', async () => {
    const accountsStore = useAccountsStore()
    const themeStore = useThemeStore()
    accountsStore.addAccount(makeAccount('acc-z'))

    const theme = {
      id: 'custom-1',
      name: 'X',
      base: 'dark' as const,
      props: { bg: '#123' },
    }
    await themeStore.applyAccountTheme(theme, 'dark', 'acc-z')
    expect(themeStore.getAccountThemes('acc-z')?.dark).toBeDefined()

    await themeStore.clearAccountTheme('dark', 'acc-z')

    expect(themeStore.getAccountThemes('acc-z')?.dark).toBeUndefined()
    expect(commands.apiDeleteRegistryValue).not.toHaveBeenCalled()
  })
})

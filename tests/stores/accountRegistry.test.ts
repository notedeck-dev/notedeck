// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountRegistryStore } from '@/stores/accountRegistry'

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiGetRegistryValue: vi.fn(),
      apiSetRegistryValue: vi.fn(),
      apiDeleteRegistryValue: vi.fn(),
      apiListRegistryKeys: vi.fn(),
    },
  }
})

import { commands } from '@/utils/tauriInvoke'

const mockGet = vi.mocked(commands.apiGetRegistryValue)
const mockSet = vi.mocked(commands.apiSetRegistryValue)
const mockDelete = vi.mocked(commands.apiDeleteRegistryValue)
const mockListKeys = vi.mocked(commands.apiListRegistryKeys)

const SCOPE = ['client', 'preferences', 'sync']

describe('accountRegistry store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('get() fetches via API on cache miss and stores the value', async () => {
    mockGet.mockResolvedValueOnce({ status: 'ok', data: 'dark-theme-id' })
    const store = useAccountRegistryStore()

    const result = await store.get('acc1', SCOPE, 'theme:dark')

    expect(result).toBe('dark-theme-id')
    expect(mockGet).toHaveBeenCalledWith('acc1', SCOPE, 'theme:dark')
    expect(store.getCached('acc1', SCOPE, 'theme:dark')).toBe('dark-theme-id')
  })

  it('get() does not call API when cache is hit', async () => {
    mockGet.mockResolvedValueOnce({ status: 'ok', data: 'dark-theme-id' })
    const store = useAccountRegistryStore()

    await store.get('acc1', SCOPE, 'theme:dark')
    mockGet.mockClear()
    const second = await store.get('acc1', SCOPE, 'theme:dark')

    expect(second).toBe('dark-theme-id')
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('get() returns null and stores negative cache when API fails', async () => {
    mockGet.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'Network', message: 'offline' },
    })
    const store = useAccountRegistryStore()

    const result = await store.get('acc1', SCOPE, 'missing')

    expect(result).toBeNull()
    expect(store.getCached('acc1', SCOPE, 'missing')).toBeNull()
  })

  it('set() writes through cache and persists to localStorage', async () => {
    mockSet.mockResolvedValueOnce({ status: 'ok', data: null })
    const store = useAccountRegistryStore()

    await store.set('acc1', SCOPE, 'theme:dark', 'my-theme')

    expect(mockSet).toHaveBeenCalledWith(
      'acc1',
      SCOPE,
      'theme:dark',
      'my-theme',
    )
    expect(store.getCached('acc1', SCOPE, 'theme:dark')).toBe('my-theme')

    const persisted = localStorage.getItem('nd-account-registry')
    expect(persisted).toContain('my-theme')
  })

  it('remove() deletes cache entry and calls API', async () => {
    mockSet.mockResolvedValueOnce({ status: 'ok', data: null })
    mockDelete.mockResolvedValueOnce({ status: 'ok', data: null })
    const store = useAccountRegistryStore()

    await store.set('acc1', SCOPE, 'theme:dark', 'my-theme')
    await store.remove('acc1', SCOPE, 'theme:dark')

    expect(mockDelete).toHaveBeenCalledWith('acc1', SCOPE, 'theme:dark')
    expect(store.getCached('acc1', SCOPE, 'theme:dark')).toBeUndefined()
  })

  it('invalidate() drops all cache entries for an account', async () => {
    mockGet
      .mockResolvedValueOnce({ status: 'ok', data: 'dark' })
      .mockResolvedValueOnce({ status: 'ok', data: 'light' })
      .mockResolvedValueOnce({ status: 'ok', data: 'other-dark' })
    const store = useAccountRegistryStore()

    await store.get('acc1', SCOPE, 'theme:dark')
    await store.get('acc1', SCOPE, 'theme:light')
    await store.get('acc2', SCOPE, 'theme:dark')

    store.invalidate('acc1')

    expect(store.getCached('acc1', SCOPE, 'theme:dark')).toBeUndefined()
    expect(store.getCached('acc1', SCOPE, 'theme:light')).toBeUndefined()
    expect(store.getCached('acc2', SCOPE, 'theme:dark')).toBe('other-dark')
  })

  it('listKeys() returns the type map from API', async () => {
    mockListKeys.mockResolvedValueOnce({
      status: 'ok',
      data: { 'theme:dark': 'string', plugins: 'array' },
    })
    const store = useAccountRegistryStore()

    const result = await store.listKeys('acc1', SCOPE)

    expect(result).toEqual({ 'theme:dark': 'string', plugins: 'array' })
    expect(mockListKeys).toHaveBeenCalledWith('acc1', SCOPE)
  })

  it('listKeys() returns empty object when API fails', async () => {
    mockListKeys.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'API', message: 'boom' },
    })
    const store = useAccountRegistryStore()

    const result = await store.listKeys('acc1', SCOPE)

    expect(result).toEqual({})
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MisskeyTheme } from '@/theme/types'
import { STORAGE_KEYS } from '@/utils/storage'
import { useThemeStore } from './theme'

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: false }
})

const RED: MisskeyTheme = {
  id: 'red-theme',
  name: 'Red',
  base: 'dark',
  props: { bg: '#ff0000' },
}

describe('useThemeStore — セーフモード (#794)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('セーフモード中は選択中のユーザーテーマを無視して組込テーマを当てる', () => {
    localStorage.setItem(STORAGE_KEYS.safeMode, 'true')
    const store = useThemeStore()
    store.installedThemes = [RED]
    store.selectedDarkThemeId = RED.id
    store.selectedLightThemeId = RED.id

    store.applyCurrentTheme()

    expect(store.currentSource?.kind).toMatch(/^builtin-/)
  })

  it('通常起動では選択中のユーザーテーマが当たる', () => {
    const store = useThemeStore()
    store.installedThemes = [RED]
    store.selectedDarkThemeId = RED.id
    store.selectedLightThemeId = RED.id

    store.applyCurrentTheme()

    expect(store.currentSource?.kind).toMatch(/^custom-/)
  })

  it('セーフモード中はカスタム CSS を注入しない', () => {
    localStorage.setItem(STORAGE_KEYS.safeMode, 'true')
    const store = useThemeStore()

    store.setCustomCss('body { display: none }')

    expect(document.adoptedStyleSheets.length).toBe(0)
    expect(document.head.querySelector('style[data-nd-custom-css]')).toBeNull()
  })
})

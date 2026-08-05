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

const BLUE: MisskeyTheme = {
  id: 'blue-theme',
  name: 'Blue',
  base: 'dark',
  props: { bg: '#0000ff' },
}

describe('useThemeStore.removeTheme (undo) — #988', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('元の位置に戻す undo を返す', () => {
    const store = useThemeStore()
    store.installedThemes = [RED, BLUE]

    const undo = store.removeTheme(RED.id)
    expect(store.installedThemes.map((t) => t.id)).toEqual([BLUE.id])
    expect(undo).toBeTypeOf('function')

    undo?.()
    expect(store.installedThemes.map((t) => t.id)).toEqual([RED.id, BLUE.id])
    expect(store.installedThemes[0]?.props.bg).toBe('#ff0000')
  })

  it('未知の id には undefined を返す', () => {
    const store = useThemeStore()
    expect(store.removeTheme('nope')).toBeUndefined()
  })

  it('undo で選択中テーマの指定も復元する', () => {
    const store = useThemeStore()
    store.installedThemes = [RED]
    store.selectedDarkThemeId = RED.id
    store.selectedLightThemeId = RED.id

    const undo = store.removeTheme(RED.id)
    expect(store.selectedDarkThemeId).toBeNull()
    expect(store.selectedLightThemeId).toBeNull()

    undo?.()
    expect(store.selectedDarkThemeId).toBe(RED.id)
    expect(store.selectedLightThemeId).toBe(RED.id)
  })

  it('undo までに同じ id が再追加されていたら二重化しない', () => {
    const store = useThemeStore()
    store.installedThemes = [RED]

    const undo = store.removeTheme(RED.id)
    store.installedThemes = [{ ...RED, name: 'Readded' }]
    undo?.()

    expect(store.installedThemes.filter((t) => t.id === RED.id)).toHaveLength(1)
    expect(store.installedThemes[0]?.name).toBe('Readded')
  })
})

describe('useThemeStore.unlinkAccountFromTheme — #988', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('紐付けが自分だけなら本体が消えるので undo を返す', () => {
    const store = useThemeStore()
    store.installedThemes = [{ ...RED, $notedeck: { installedFor: ['acc-1'] } }]

    const undo = store.unlinkAccountFromTheme(RED.id, 'acc-1')
    expect(store.installedThemes).toHaveLength(0)
    expect(undo).toBeTypeOf('function')

    undo?.()
    expect(store.installedThemes.map((t) => t.id)).toEqual([RED.id])
  })

  it('他アカウントの紐付けが残るなら本体は消えず undo も返さない', () => {
    const store = useThemeStore()
    store.installedThemes = [
      { ...RED, $notedeck: { installedFor: ['acc-1', 'acc-2'] } },
    ]

    const undo = store.unlinkAccountFromTheme(RED.id, 'acc-1')
    expect(undo).toBeUndefined()
    expect(store.installedThemes[0]?.$notedeck?.installedFor).toEqual(['acc-2'])
  })
})

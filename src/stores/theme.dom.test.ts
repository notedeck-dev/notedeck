import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountsStore } from '@/stores/accounts'
import { DARK_BASE, DARK_THEME } from '@/theme/builtinThemes'
import { compileMisskeyTheme } from '@/theme/compiler'
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

describe('useThemeStore.installTheme — 同一 ID の貼り付けは更新扱い (#913)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('貼り付けコードに $notedeck が無ければ既存の $notedeck を保持する', async () => {
    const store = useThemeStore()
    store.installedThemes = [
      { ...RED, $notedeck: { storeId: 'red-store', installedFor: ['acc-1'] } },
    ]

    const ok = await store.installTheme(
      JSON.stringify({ id: RED.id, name: 'Red v2', props: { bg: '#f00' } }),
    )

    expect(ok).toBe(true)
    expect(store.installedThemes).toHaveLength(1)
    expect(store.installedThemes[0]?.name).toBe('Red v2')
    expect(store.installedThemes[0]?.$notedeck?.storeId).toBe('red-store')
    expect(store.installedThemes[0]?.$notedeck?.installedFor).toEqual(['acc-1'])
  })

  it('貼り付けコードに $notedeck があればそちらを採用する', async () => {
    const store = useThemeStore()
    store.installedThemes = [{ ...RED, $notedeck: { storeId: 'old-store' } }]

    const ok = await store.installTheme(
      JSON.stringify({
        id: RED.id,
        name: 'Red v3',
        props: { bg: '#f00' },
        $notedeck: { storeId: 'new-store' },
      }),
    )

    expect(ok).toBe(true)
    expect(store.installedThemes[0]?.$notedeck?.storeId).toBe('new-store')
  })

  it('更新扱いでも既存の fileBase (対応表) を引き継ぐ', async () => {
    const store = useThemeStore()
    store.installedThemes = [{ ...RED, fileBase: 'red' }]

    await store.installTheme(
      JSON.stringify({ id: RED.id, name: 'Red v2', props: { bg: '#f00' } }),
    )

    expect(store.installedThemes[0]?.fileBase).toBe('red')
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

describe('useThemeStore.getStyleVarsForAccount — グローバルテーマの適用範囲 (#1046)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  /** グローバルにカスタムテーマ RED を選択した dark モードの状態を作る */
  function selectRedGlobally() {
    const store = useThemeStore()
    store.manualMode = 'dark'
    store.installedThemes = [RED]
    store.selectedDarkThemeId = RED.id
    store.applyCurrentTheme()
    return store
  }

  it('per-account テーマが無いアカウントのカラムには組込テーマを当てる', () => {
    const store = selectRedGlobally()

    const vars = store.getStyleVarsForAccount('acc-no-theme')

    const builtin = compileMisskeyTheme(DARK_THEME, DARK_BASE)
    expect(vars?.['--nd-bg']).toBe(builtin.bg)
    expect(vars?.['--nd-bg']).not.toBe(RED.props.bg)
  })

  it('per-account テーマを持つアカウントのカラムにはそのテーマを当てる', () => {
    const store = selectRedGlobally()
    store.accountThemeCache = new Map([['acc-1', { dark: BLUE }]])

    const vars = store.getStyleVarsForAccount('acc-1')

    expect(vars?.['--nd-bg']).toBe(BLUE.props.bg)
  })

  it('セーフモード中はカラムに何も当てない (組込テーマがグローバルに当たっている)', () => {
    localStorage.setItem(STORAGE_KEYS.safeMode, 'true')
    const store = selectRedGlobally()

    expect(store.getStyleVarsForAccount('acc-no-theme')).toBeUndefined()
  })
})

describe('useThemeStore.migrateScopes — installedFor を安定キーへ (#1113)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    const accounts = useAccountsStore()
    accounts.accounts = [
      {
        id: 'uuid-1',
        host: 'example.com',
        userId: 'u1',
        username: 'one',
        displayName: null,
        avatarUrl: null,
        software: 'misskey-dev/misskey',
        hasToken: true,
      },
    ] as never
    accounts.isLoaded = true
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('旧 UUID は現行アカウントの安定キーへ置換し、該当しない UUID は捨てる', () => {
    const store = useThemeStore()
    store.installedThemes = [
      {
        ...RED,
        $notedeck: { installedFor: ['uuid-1', 'uuid-dead', 'other.host:u9'] },
      },
    ]
    store.migrateScopes()
    expect(store.installedThemes[0]?.$notedeck?.installedFor).toEqual([
      'example.com:u1',
      'other.host:u9',
    ])
  })

  it('紐付け先が全滅した個体は現行の全アカウントに紐付け直す (ゾンビ化させない)', () => {
    const store = useThemeStore()
    store.installedThemes = [
      { ...RED, $notedeck: { installedFor: ['uuid-dead'] } },
    ]
    store.migrateScopes()
    expect(store.installedThemes[0]?.$notedeck?.installedFor).toEqual([
      'example.com:u1',
    ])
  })

  it('安定キーだけの個体と紐付けの無い個体には触れない (冪等)', () => {
    const store = useThemeStore()
    store.installedThemes = [
      { ...RED, $notedeck: { installedFor: ['example.com:u1'] } },
      { ...RED, id: 'blue', name: 'Blue' },
    ]
    store.migrateScopes()
    expect(store.installedThemes[0]?.$notedeck?.installedFor).toEqual([
      'example.com:u1',
    ])
    expect(store.installedThemes[1]?.$notedeck).toBeUndefined()
  })
})

describe('useThemeStore.purgeAccount — アカウント削除でスコープ参加を掃除する (#1114)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('そのアカウントのキーだけを外し、紐付けが無くなるテーマは本体ごと消す (手動の「外す」と同じ)', () => {
    const store = useThemeStore()
    store.installedThemes = [
      { ...RED, $notedeck: { installedFor: ['h:u1', 'h:u2'] } },
      {
        ...RED,
        id: 'blue',
        name: 'Blue',
        $notedeck: { installedFor: ['h:u1'] },
      },
      { ...RED, id: 'green', name: 'Green' },
    ]
    store.purgeAccount('h:u1')
    expect(store.installedThemes.map((t) => t.id)).toEqual([RED.id, 'green'])
    expect(store.installedThemes[0]?.$notedeck?.installedFor).toEqual(['h:u2'])
  })
})

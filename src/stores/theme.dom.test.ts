// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountsStore } from '@/stores/accounts'
import { DARK_BASE, DARK_THEME } from '@/theme/builtinThemes'
import { compileMisskeyTheme } from '@/theme/compiler'
import type { MisskeyTheme } from '@/theme/types'
import { STORAGE_KEYS } from '@/utils/storage'
import { type ThemeItem, useThemeStore } from './theme'

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: false }
})
vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

function item(
  id: string,
  name: string,
  props: Record<string, string>,
  partial: Partial<ThemeItem> = {},
): ThemeItem {
  return {
    id,
    name,
    createdAt: 1,
    updatedAt: 1,
    scope: { kind: 'shared', global: false, installedFor: [] },
    content: { base: 'dark', props },
    extra: {},
    ...partial,
  }
}

/** 紐付けつきの個体 */
function linked(base: ThemeItem, installedFor: string[]): ThemeItem {
  return { ...base, scope: { kind: 'shared', global: false, installedFor } }
}

const RED = item('red-theme', 'Red', { bg: '#ff0000' })
const BLUE = item('blue-theme', 'Blue', { bg: '#0000ff' })
const BLUE_MISSKEY: MisskeyTheme = {
  id: BLUE.id,
  name: BLUE.name,
  base: 'dark',
  props: BLUE.content.props,
}

function installedFor(store: ReturnType<typeof useThemeStore>, id: string) {
  const s = store.get(id)?.scope
  return s?.kind === 'shared' ? s.installedFor : undefined
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('useThemeStore — セーフモード (#794)', () => {
  it('セーフモード中は選択中のユーザーテーマを無視して組込テーマを当てる', () => {
    localStorage.setItem(STORAGE_KEYS.safeMode, 'true')
    const store = useThemeStore()
    store.items = [RED]
    store.selectedDarkThemeId = RED.id
    store.selectedLightThemeId = RED.id

    store.applyCurrentTheme()

    expect(store.currentSource?.kind).toMatch(/^builtin-/)
  })

  it('通常起動では選択中のユーザーテーマが当たる', () => {
    const store = useThemeStore()
    store.items = [RED]
    store.selectedDarkThemeId = RED.id
    store.selectedLightThemeId = RED.id

    store.applyCurrentTheme()

    expect(store.currentSource?.kind).toMatch(/^custom-/)
    expect(store.currentSource?.theme.props.bg).toBe('#ff0000')
  })

  it('セーフモード中はカスタム CSS を注入しない', () => {
    localStorage.setItem(STORAGE_KEYS.safeMode, 'true')
    const store = useThemeStore()

    store.setCustomCss('body { display: none }')

    expect(document.adoptedStyleSheets.length).toBe(0)
    expect(document.head.querySelector('style[data-nd-custom-css]')).toBeNull()
  })
})

describe('useThemeStore.removeTheme (undo) — #988', () => {
  it('元の位置に戻す undo を返す', async () => {
    const store = useThemeStore()
    store.items = [RED, BLUE]

    const undo = await store.removeTheme(RED.id)
    expect(store.items.map((t) => t.id)).toEqual([BLUE.id])
    expect(undo).toBeTypeOf('function')

    undo?.()
    expect(store.items.map((t) => t.id)).toEqual([RED.id, BLUE.id])
    expect(store.items[0]?.content.props.bg).toBe('#ff0000')
  })

  it('未知の id には undefined を返す', async () => {
    const store = useThemeStore()
    expect(await store.removeTheme('nope')).toBeUndefined()
  })

  it('選択中のテーマを消すと選択が外れて組込に戻り、undo で選択も復元する', async () => {
    const store = useThemeStore()
    store.items = [RED]
    store.selectedDarkThemeId = RED.id
    store.selectedLightThemeId = RED.id
    store.applyCurrentTheme()
    expect(store.currentSource?.kind).toMatch(/^custom-/)

    const undo = await store.removeTheme(RED.id)
    expect(store.selectedDarkThemeId).toBeNull()
    expect(store.selectedLightThemeId).toBeNull()
    expect(store.currentSource?.kind).toMatch(/^builtin-/)

    undo?.()
    expect(store.selectedDarkThemeId).toBe(RED.id)
    expect(store.selectedLightThemeId).toBe(RED.id)
    expect(store.currentSource?.kind).toMatch(/^custom-/)
  })

  it('undo までに同じ id が再追加されていたら二重化しない', async () => {
    const store = useThemeStore()
    store.items = [RED]

    const undo = await store.removeTheme(RED.id)
    store.items = [{ ...RED, name: 'Readded' }]
    undo?.()

    expect(store.items.filter((t) => t.id === RED.id)).toHaveLength(1)
    expect(store.items[0]?.name).toBe('Readded')
  })
})

describe('useThemeStore.installTheme — JSON コードの取り込み (#913)', () => {
  it('同じ id は更新扱いで、名前と本文を差し替えストア由来と紐付けは保つ', async () => {
    const store = useThemeStore()
    store.items = [linked({ ...RED, store: { id: 'red-store' } }, ['acc-1'])]

    const ok = await store.installTheme(
      JSON.stringify({ id: RED.id, name: 'Red v2', props: { bg: '#f00' } }),
    )

    expect(ok).toBe(true)
    expect(store.items).toHaveLength(1)
    expect(store.items[0]).toMatchObject({
      name: 'Red v2',
      content: { props: { bg: '#f00' } },
      store: { id: 'red-store' },
    })
    expect(installedFor(store, RED.id)).toEqual(['acc-1'])
  })

  it('無い id は追加で、$notedeck のストア由来と紐付けを読む', async () => {
    const store = useThemeStore()
    const ok = await store.installTheme(
      JSON.stringify({
        id: 'new',
        name: 'New',
        base: 'light',
        props: { bg: '#fff' },
        $notedeck: { storeId: 'new-store', installedFor: ['acc-1'] },
      }),
      ['acc-2'],
    )
    expect(ok).toBe(true)
    expect(store.get('new')).toMatchObject({
      name: 'New',
      content: { base: 'light', props: { bg: '#fff' } },
      store: { id: 'new-store' },
    })
    expect(installedFor(store, 'new')).toEqual(['acc-1', 'acc-2'])
  })

  it('props の無いコードや壊れた JSON は入れない', async () => {
    const store = useThemeStore()
    expect(await store.installTheme('{ id: "x" }')).toBe(false)
    expect(await store.installTheme('not json')).toBe(false)
    expect(store.items).toHaveLength(0)
  })

  it('選択中のテーマを更新すると当て直す', async () => {
    const store = useThemeStore()
    store.items = [RED]
    store.selectedDarkThemeId = RED.id
    store.selectedLightThemeId = RED.id
    store.applyCurrentTheme()

    await store.installTheme(
      JSON.stringify({ id: RED.id, name: 'Red', props: { bg: '#123456' } }),
    )
    expect(store.currentSource?.theme.props.bg).toBe('#123456')
  })
})

describe('useThemeStore.unlinkAccountFromTheme — #988', () => {
  it('紐付けが自分だけなら本体が消えるので undo を返す', async () => {
    const store = useThemeStore()
    store.items = [linked(RED, ['acc-1'])]

    const undo = await store.unlinkAccountFromTheme(RED.id, 'acc-1')
    expect(store.items).toHaveLength(0)
    expect(undo).toBeTypeOf('function')

    undo?.()
    expect(store.items.map((t) => t.id)).toEqual([RED.id])
  })

  it('他アカウントの紐付けが残るなら本体は消えず undo も返さない', async () => {
    const store = useThemeStore()
    store.items = [linked(RED, ['acc-1', 'acc-2'])]

    const undo = await store.unlinkAccountFromTheme(RED.id, 'acc-1')
    expect(undo).toBeUndefined()
    expect(installedFor(store, RED.id)).toEqual(['acc-2'])
  })

  it('紐付いていないアカウントを外しても何もしない', async () => {
    const store = useThemeStore()
    store.items = [linked(RED, ['acc-1'])]
    expect(await store.unlinkAccountFromTheme(RED.id, 'acc-9')).toBeUndefined()
    expect(installedFor(store, RED.id)).toEqual(['acc-1'])
  })
})

describe('useThemeStore.getStyleVarsForAccount — グローバルテーマの適用範囲 (#1046)', () => {
  /** グローバルにカスタムテーマ RED を選択した dark モードの状態を作る */
  function selectRedGlobally() {
    const store = useThemeStore()
    store.manualMode = 'dark'
    store.items = [RED]
    store.selectedDarkThemeId = RED.id
    store.applyCurrentTheme()
    return store
  }

  it('per-account テーマが無いアカウントのカラムには組込テーマを当てる', () => {
    const store = selectRedGlobally()

    const vars = store.getStyleVarsForAccount('acc-no-theme')

    const builtin = compileMisskeyTheme(DARK_THEME, DARK_BASE)
    expect(vars?.['--nd-bg']).toBe(builtin.bg)
    expect(vars?.['--nd-bg']).not.toBe(RED.content.props.bg)
  })

  it('per-account テーマを持つアカウントのカラムにはそのテーマを当てる', () => {
    const store = selectRedGlobally()
    store.accountThemeCache = new Map([['acc-1', { dark: BLUE_MISSKEY }]])

    const vars = store.getStyleVarsForAccount('acc-1')

    expect(vars?.['--nd-bg']).toBe(BLUE.content.props.bg)
  })

  it('セーフモード中はカラムに何も当てない (組込テーマがグローバルに当たっている)', () => {
    localStorage.setItem(STORAGE_KEYS.safeMode, 'true')
    const store = selectRedGlobally()

    expect(store.getStyleVarsForAccount('acc-no-theme')).toBeUndefined()
  })
})

describe('useThemeStore.migrateScopes — installedFor を安定キーへ (#1113)', () => {
  beforeEach(() => {
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

  it('旧 UUID は現行アカウントの安定キーへ置換し、該当しない UUID は捨てる', async () => {
    const store = useThemeStore()
    store.items = [linked(RED, ['uuid-1', 'uuid-dead', 'other.host:u9'])]
    await store.migrateScopes()
    expect(installedFor(store, RED.id)?.sort()).toEqual([
      'example.com:u1',
      'other.host:u9',
    ])
  })

  it('紐付け先が全滅した個体は現行の全アカウントに紐付け直す (ゾンビ化させない)', async () => {
    const store = useThemeStore()
    store.items = [linked(RED, ['uuid-dead'])]
    await store.migrateScopes()
    expect(installedFor(store, RED.id)).toEqual(['example.com:u1'])
  })

  it('安定キーだけの個体と紐付けの無い個体には触れない (冪等)', async () => {
    const store = useThemeStore()
    store.items = [linked(RED, ['example.com:u1']), BLUE]
    await store.migrateScopes()
    expect(installedFor(store, RED.id)).toEqual(['example.com:u1'])
    expect(installedFor(store, BLUE.id)).toEqual([])
  })
})

describe('useThemeStore.purgeAccount — アカウント削除でスコープ参加を掃除する (#1114)', () => {
  it('そのアカウントのキーだけを外し、紐付けが無くなるテーマは本体ごと消す (手動の「外す」と同じ)', async () => {
    const store = useThemeStore()
    store.items = [
      linked(RED, ['h:u1', 'h:u2']),
      linked(item('blue', 'Blue', { bg: '#00f' }), ['h:u1']),
      item('green', 'Green', { bg: '#0f0' }),
    ]
    await store.purgeAccount('h:u1')
    expect(store.items.map((t) => t.id)).toEqual([RED.id, 'green'])
    expect(installedFor(store, RED.id)).toEqual(['h:u2'])
  })

  it('内部 ID を渡すと per-account テーマキャッシュの entry も消す (#1118 レビュー指摘)', async () => {
    const store = useThemeStore()
    store.items = [linked(RED, ['h:u1'])]
    store.applyAccountTheme(
      { id: RED.id, name: RED.name, base: 'dark', props: RED.content.props },
      'dark',
      'uuid-1',
    )
    expect(store.accountThemeCache.get('uuid-1')).toBeDefined()
    await store.purgeAccount('h:u1', 'uuid-1')
    expect(store.accountThemeCache.get('uuid-1')).toBeUndefined()
    expect(store.items).toHaveLength(0)
  })
})

describe('useThemeStore.linkAccountToTheme — ライブラリから追加 (テーマのピッカー)', () => {
  it('アカウントの安定キーを紐付けに足す (union、重複しない)。未知の id は false', async () => {
    const store = useThemeStore()
    store.items = [linked(RED, ['h:u1'])]
    expect(await store.linkAccountToTheme(RED.id, 'h:u2')).toBe(true)
    expect(installedFor(store, RED.id)).toEqual(['h:u1', 'h:u2'])
    expect(await store.linkAccountToTheme(RED.id, 'h:u2')).toBe(true)
    expect(installedFor(store, RED.id)).toEqual(['h:u1', 'h:u2'])
    expect(await store.linkAccountToTheme('nope', 'h:u1')).toBe(false)
  })
})

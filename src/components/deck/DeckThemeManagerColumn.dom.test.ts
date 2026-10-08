// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { type Account, useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { type StoreThemeEntry, useMisStoreStore } from '@/stores/misstore'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import { useWindowsStore } from '@/stores/windows'
import type { MisskeyTheme } from '@/theme/types'
import { STORAGE_KEYS } from '@/utils/storage'
import DeckThemeManagerColumn from './DeckThemeManagerColumn.vue'

/**
 * テーマ管理カラムの UI ブロックの振る舞い。5 種の配布物管理カラムの統合
 * (#1202) で崩れないための安全網。store の規則そのもの (undo の中身など) は
 * stores/theme.dom.test.ts が持ち、ここは「カラムからどう呼ばれ、何が見えるか」
 * だけを見る。
 */

const confirmMock = vi.fn<(opts: unknown) => Promise<boolean>>()
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}))

const toastShow =
  vi.fn<
    (
      text: string,
      type?: string,
      options?: { action?: { label: string; onClick: () => void } },
    ) => void
  >()
vi.mock('@/stores/toast', () => ({
  useToast: () => ({ show: toastShow }),
}))

// --- fixtures ---

const ACCOUNT_A: Account = {
  id: 'uuid-a',
  host: 'a.example',
  userId: 'ua',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  software: 'misskey-dev/misskey',
  hasToken: true,
}
const ACCOUNT_B: Account = {
  id: 'uuid-b',
  host: 'b.example',
  userId: 'ub',
  username: 'bob',
  displayName: 'Bob',
  avatarUrl: null,
  software: 'misskey-dev/misskey',
  hasToken: true,
}
const KEY_A = 'a.example:ua'
const KEY_B = 'b.example:ub'

function theme(
  id: string,
  name: string,
  extra: Partial<MisskeyTheme> = {},
): MisskeyTheme {
  return { id, name, base: 'dark', props: { bg: '#111111' }, ...extra }
}

/** サイドロード (storeId 無し) のテーマ。installedFor は呼び手が決める */
function local(id: string, name: string, installedFor: string[]) {
  return theme(id, name, { $notedeck: { installedFor } })
}

/** MisStore 由来 (storeId 付き) のテーマ */
function fromStore(id: string, name: string, installedFor: string[]) {
  return theme(id, name, {
    $notedeck: { storeId: `${id}-store`, installedFor },
  })
}

const STORE_ENTRY: StoreThemeEntry = {
  id: 'reg-theme',
  name: 'Registry Theme',
  version: '1.0.0',
  author: 'someone',
  description: 'from the registry',
  base: 'dark',
  tags: ['dark'],
  sourceUrl: 'https://store.notedeck.io/themes/reg-theme.json',
  apiUrl: 'https://store.notedeck.io/api/themes/reg-theme',
  sha512: 'abc',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  themeProps: { bg: '#222222' },
}

function column(accountId: string | null): DeckColumnType {
  return {
    id: 'col-theme',
    type: 'themeManager',
    name: null,
    width: 320,
    accountId,
  } as DeckColumnType
}

function mountColumn(accountId: string | null) {
  return mount(DeckThemeManagerColumn, {
    props: { column: column(accountId) },
    global: {
      stubs: {
        DeckColumn: {
          template: '<div><slot name="header-meta" /><slot /></div>',
        },
      },
    },
  })
}

type Wrapper = VueWrapper<InstanceType<typeof DeckThemeManagerColumn>>

/** セクション見出し (label) の一覧 */
function sectionLabels(wrapper: Wrapper): string[] {
  return wrapper.findAll('section').map((s) => s.find('button span').text())
}

/** セクション見出し → そのセクション内のテーマ名 */
function sectionThemes(wrapper: Wrapper, label: string): string[] {
  const section = wrapper
    .findAll('section')
    .find((s) => s.find('button span').text() === label)
  if (!section) return []
  return wrapper
    .findAllComponents({ name: 'ThemeCard' })
    .filter((c) => section.element.contains(c.element))
    .map((c) => c.text())
}

function cardNamed(wrapper: Wrapper, name: string) {
  const card = wrapper
    .findAllComponents({ name: 'ThemeCard' })
    .find((c) => c.text() === name)
  if (!card) throw new Error(`ThemeCard "${name}" not found`)
  return card
}

function buttonTitled(wrapper: Wrapper, title: string) {
  const btn = wrapper
    .findAll('button')
    .find((b) => b.attributes('title') === title)
  if (!btn) throw new Error(`button "${title}" not found`)
  return btn
}

async function switchToStore(wrapper: Wrapper) {
  const tab = wrapper.findAll('button').find((b) => b.text() === 'ストア')
  if (!tab) throw new Error('store tab not found')
  await tab.trigger('click')
  await flushPromises()
}

describe('DeckThemeManagerColumn', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    confirmMock.mockReset()
    toastShow.mockReset()
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ themes: [STORE_ENTRY] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const accounts = useAccountsStore()
    accounts.accounts = [ACCOUNT_A, ACCOUNT_B]
    accounts.isLoaded = true
    // OS の明暗に依らず dark 固定にする (再適用で light に揺れると一覧が入れ替わる)
    useThemeStore().manualMode = 'dark'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('インストール済み / ストアのタブを切り替えると、検索欄とカード面が入れ替わる', async () => {
    const wrapper = mountColumn(null)
    await flushPromises()
    expect(wrapper.find('input').attributes('placeholder')).toBe(
      'インストール済みを探す',
    )
    expect(wrapper.text()).toContain('インストール済み')
    expect(wrapper.text()).not.toContain('Registry Theme')

    await switchToStore(wrapper)
    expect(wrapper.find('input').attributes('placeholder')).toBe('ストアを探す')
    expect(wrapper.text()).toContain('Registry Theme')
    expect(wrapper.find('section').exists()).toBe(false)
  })

  it('全アカウントカラムは「デフォルト」に Mi Dark を出し、編集も削除もできない', async () => {
    const wrapper = mountColumn(null)
    await flushPromises()

    expect(sectionThemes(wrapper, 'デフォルト')).toEqual(['Mi Dark'])
    const card = cardNamed(wrapper, 'Mi Dark')
    expect(card.find('button[title="編集"]').exists()).toBe(false)
    expect(
      card
        .find('button[title="ライブラリから削除 (テーマも消えます)"]')
        .exists(),
    ).toBe(false)
  })

  it('全アカウントカラムはサイドロードとストア配布を出自ごとに分け、サイドロードだけ編集できる', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [
      local('side-1', 'Side One', [KEY_A]),
      fromStore('st-1', 'Store One', [KEY_B]),
    ]
    const wrapper = mountColumn(null)
    await flushPromises()

    expect(sectionLabels(wrapper)).toEqual([
      'デフォルト',
      'サイドロード',
      'ストア配布',
    ])
    expect(sectionThemes(wrapper, 'サイドロード')).toEqual(['Side One'])
    expect(sectionThemes(wrapper, 'ストア配布')).toEqual(['Store One'])
    expect(
      cardNamed(wrapper, 'Side One').find('button[title="編集"]').exists(),
    ).toBe(true)
    expect(
      cardNamed(wrapper, 'Store One').find('button[title="編集"]').exists(),
    ).toBe(false)
  })

  it('アカウントカラムはサーバー (admin Branding) のテーマを読取専用で出し、デフォルトは出さない', async () => {
    const themeStore = useThemeStore()
    themeStore.accountThemeCache = new Map([
      [ACCOUNT_A.id, { metaDark: theme('srv', 'Server Dark') }],
    ])
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    expect(sectionLabels(wrapper)).toEqual(['サーバー'])
    expect(sectionThemes(wrapper, 'サーバー')).toEqual(['Server Dark'])
    const card = cardNamed(wrapper, 'Server Dark')
    expect(card.findAll('button[title]')).toHaveLength(0)
  })

  it('アカウントカラムは installedFor にそのアカウントを含むテーマだけを出す', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [
      local('side-a', 'Side A', [KEY_A]),
      local('side-b', 'Side B', [KEY_B]),
      fromStore('st-ab', 'Store AB', [KEY_A, KEY_B]),
      fromStore('st-b', 'Store B', [KEY_B]),
    ]
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    expect(sectionThemes(wrapper, 'サイドロード')).toEqual(['Side A'])
    expect(sectionThemes(wrapper, 'ストア配布')).toEqual(['Store AB'])
    expect(wrapper.text()).not.toContain('Side B')
    expect(wrapper.text()).not.toContain('Store B')
  })

  it('現在のモードと違う base のテーマは出さない', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [
      local('dark-1', 'Dark One', [KEY_A]),
      { ...local('light-1', 'Light One', [KEY_A]), base: 'light' },
    ]
    const wrapper = mountColumn(null)
    await flushPromises()

    expect(sectionThemes(wrapper, 'サイドロード')).toEqual(['Dark One'])
    expect(wrapper.text()).not.toContain('Light One')
  })

  it('検索語を入れると名前の一致するテーマだけに絞り、空セクションは消える', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [
      local('side-1', 'Sunset', [KEY_A]),
      fromStore('st-1', 'Midnight', [KEY_A]),
    ]
    const wrapper = mountColumn(null)
    await flushPromises()

    await wrapper.find('input').setValue('mid')
    expect(sectionLabels(wrapper)).toEqual(['ストア配布'])
    expect(sectionThemes(wrapper, 'ストア配布')).toEqual(['Midnight'])

    await wrapper.find('input').setValue('zzz')
    expect(wrapper.text()).toContain('一致するテーマがありません')
  })

  it('全アカウントカラムで dark テーマのカードを押すと、settings の dark の選択が変わる', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [local('side-1', 'Sunset', [KEY_A])]
    const wrapper = mountColumn(null)
    await flushPromises()

    await cardNamed(wrapper, 'Sunset').trigger('click')

    expect(useSettingsStore().get('theme.selectedDarkThemeId')).toBe('side-1')
    expect(themeStore.selectedLightThemeId).toBeNull()
  })

  it('light モードでは light テーマが並び、押すと light の選択が変わる', async () => {
    const themeStore = useThemeStore()
    themeStore.manualMode = 'light'
    themeStore.applyCurrentTheme()
    themeStore.installedThemes = [
      local('dark-1', 'Dark One', [KEY_A]),
      { ...local('light-1', 'Light One', [KEY_A]), base: 'light' },
    ]
    const wrapper = mountColumn(null)
    await flushPromises()

    expect(sectionThemes(wrapper, 'デフォルト')).toEqual(['Mi Light'])
    expect(sectionThemes(wrapper, 'サイドロード')).toEqual(['Light One'])

    await cardNamed(wrapper, 'Light One').trigger('click')

    expect(useSettingsStore().get('theme.selectedLightThemeId')).toBe('light-1')
    expect(themeStore.selectedDarkThemeId).toBeNull()
  })

  it('アカウントカラムでカードを押すと、そのアカウントの per-column 適用になる', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [local('side-1', 'Sunset', [KEY_A])]
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    await cardNamed(wrapper, 'Sunset').trigger('click')

    expect(themeStore.accountThemeCache.get(ACCOUNT_A.id)?.dark?.name).toBe(
      'Sunset',
    )
    expect(themeStore.selectedDarkThemeId).toBeNull()

    await nextTick()
    await buttonTitled(wrapper, 'このアカウントの設定を解除').trigger('click')
    expect(themeStore.accountThemeCache.get(ACCOUNT_A.id)).toBeUndefined()
  })

  it('他のアカウントにも紐付くテーマを外すと、本体は残りこのカラムからだけ消える', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [local('side-1', 'Shared', [KEY_A, KEY_B])]
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    const btn = buttonTitled(wrapper, 'このアカウントから外す')
    expect(btn.find('i').classes()).toContain('ti-circle-minus')
    await btn.trigger('click')
    await flushPromises()

    expect(confirmMock).not.toHaveBeenCalled()
    expect(themeStore.installedThemes).toHaveLength(1)
    expect(themeStore.installedThemes[0]?.$notedeck?.installedFor).toEqual([
      KEY_B,
    ])
    expect(wrapper.text()).not.toContain('Shared')
  })

  it('紐付けが自分だけのテーマを外すと確認のうえ本体ごと消え、トーストの「元に戻す」で戻る', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [local('side-1', 'Only Mine', [KEY_A])]
    confirmMock.mockResolvedValue(true)
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    const btn = buttonTitled(wrapper, 'ライブラリから削除 (テーマも消えます)')
    expect(btn.find('i').classes()).toContain('ti-trash')
    await btn.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'テーマを削除',
        message: expect.stringContaining('Only Mine'),
      }),
    )
    expect(themeStore.installedThemes).toHaveLength(0)
    expect(toastShow).toHaveBeenCalledWith(
      'テーマを削除しました',
      'info',
      expect.objectContaining({
        action: expect.objectContaining({ label: '元に戻す' }),
      }),
    )

    toastShow.mock.calls[0]?.[2]?.action?.onClick()
    await nextTick()
    expect(themeStore.installedThemes.map((t) => t.id)).toEqual(['side-1'])
    expect(wrapper.text()).toContain('Only Mine')
  })

  it('確認でキャンセルすると、最後の紐付けでもテーマは消えない', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [local('side-1', 'Only Mine', [KEY_A])]
    confirmMock.mockResolvedValue(false)
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    await buttonTitled(
      wrapper,
      'ライブラリから削除 (テーマも消えます)',
    ).trigger('click')
    await flushPromises()

    expect(themeStore.installedThemes).toHaveLength(1)
    expect(toastShow).not.toHaveBeenCalled()
  })

  it('全アカウントカラムから削除すると確認のうえ本体が消え、「元に戻す」で選択状態ごと戻る', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [local('side-1', 'Sunset', [KEY_A])]
    themeStore.selectTheme('side-1', 'dark')
    confirmMock.mockResolvedValue(true)
    const wrapper = mountColumn(null)
    await flushPromises()

    await buttonTitled(
      wrapper,
      'ライブラリから削除 (テーマも消えます)',
    ).trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'テーマを削除',
        message: expect.stringContaining('Sunset'),
        type: 'danger',
      }),
    )
    const settings = useSettingsStore()
    expect(themeStore.installedThemes).toHaveLength(0)
    expect(settings.get('theme.selectedDarkThemeId')).toBeNull()
    expect(toastShow).toHaveBeenCalledWith(
      'テーマを削除しました',
      'info',
      expect.objectContaining({
        action: expect.objectContaining({ label: '元に戻す' }),
      }),
    )

    toastShow.mock.calls[0]?.[2]?.action?.onClick()
    await nextTick()
    expect(themeStore.installedThemes.map((t) => t.id)).toEqual(['side-1'])
    expect(settings.get('theme.selectedDarkThemeId')).toBe('side-1')
    expect(wrapper.text()).toContain('Sunset')
  })

  it('ヘッダーの + を押すと、カラムのアカウントを初期値にしてテーマエディタを開く', async () => {
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    await buttonTitled(wrapper, '新規テーマを作成').trigger('click')

    const win = useWindowsStore().windows.find((w) => w.type === 'themeEditor')
    expect(win?.props).toEqual({ initialAccountIds: [ACCOUNT_A.id] })
  })

  it('全アカウントカラムの + は全アカウントを初期値にしてテーマエディタを開く', async () => {
    const wrapper = mountColumn(null)
    await flushPromises()

    await buttonTitled(wrapper, '新規テーマを作成').trigger('click')

    const win = useWindowsStore().windows.find((w) => w.type === 'themeEditor')
    expect(win?.props).toEqual({
      initialAccountIds: [ACCOUNT_A.id, ACCOUNT_B.id],
    })
  })

  it('サイドロードのカードの編集を押すと、そのテーマを開いた状態でテーマエディタを開く', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [local('side-1', 'Sunset', [KEY_A])]
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    await cardNamed(wrapper, 'Sunset')
      .find('button[title="編集"]')
      .trigger('click')

    const win = useWindowsStore().windows.find((w) => w.type === 'themeEditor')
    expect(win?.props).toEqual({
      initialThemeId: 'side-1',
      initialAccountIds: [ACCOUNT_A.id],
    })
  })

  it('アカウントカラムの「ライブラリから追加」は未紐付けの本体を並べ、押すとこのアカウントに紐付く', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [
      local('side-b', 'Side B', [KEY_B]),
      local('side-a', 'Side A', [KEY_A]),
    ]
    const wrapper = mountColumn(ACCOUNT_A.id)
    await flushPromises()

    const addBtn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'ライブラリから追加')
    if (!addBtn) throw new Error('add button not found')
    await addBtn.trigger('click')

    const picker = wrapper
      .findAllComponents({ name: 'ThemeCard' })
      .filter((c) => c.props('mode') === 'library')
    expect(picker.map((c) => c.text())).toEqual(['Side B'])

    await picker[0]?.trigger('click')
    expect(
      themeStore.installedThemes.find((t) => t.id === 'side-b')?.$notedeck
        ?.installedFor,
    ).toEqual([KEY_B, KEY_A])
    expect(sectionThemes(wrapper, 'サイドロード')).toEqual(['Side B', 'Side A'])
  })

  it('ストアタブはレジストリの一覧を出し、未インストールのカードを押すとこのアカウント向けにインストールする', async () => {
    const misStore = useMisStoreStore()
    const install = vi
      .spyOn(misStore, 'installTheme')
      .mockResolvedValue(undefined)
    const wrapper = mountColumn(ACCOUNT_A.id)
    await switchToStore(wrapper)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://store.notedeck.io/registry/themes.json',
    )
    expect(misStore.isThemeInstalled(STORE_ENTRY)).toBe(false)
    await cardNamed(wrapper, 'Registry Theme').trigger('click')

    expect(install).toHaveBeenCalledWith(STORE_ENTRY, [KEY_A])
  })

  it('ストアタブでインストール済み (storeId 一致) のカードを押しても再インストールしない', async () => {
    const themeStore = useThemeStore()
    themeStore.installedThemes = [
      theme('installed-reg', 'Registry Theme (local)', {
        $notedeck: { storeId: STORE_ENTRY.id, installedFor: [KEY_A] },
      }),
    ]
    const misStore = useMisStoreStore()
    const install = vi
      .spyOn(misStore, 'installTheme')
      .mockResolvedValue(undefined)
    const wrapper = mountColumn(ACCOUNT_A.id)
    await switchToStore(wrapper)

    expect(misStore.isThemeInstalled(STORE_ENTRY)).toBe(true)
    await cardNamed(wrapper, 'Registry Theme').trigger('click')

    expect(install).not.toHaveBeenCalled()
  })

  it('ストアタブの検索語で一覧を絞る', async () => {
    const wrapper = mountColumn(null)
    await switchToStore(wrapper)

    await wrapper.find('input').setValue('nothing-matches')
    expect(wrapper.findAllComponents({ name: 'ThemeCard' })).toHaveLength(0)
    expect(wrapper.text()).toContain('一致するテーマがありません')
  })

  it('セーフモードで起動していると、テーマが効いていない旨の通知を出す', async () => {
    localStorage.setItem(STORAGE_KEYS.safeMode, 'true')
    const wrapper = mountColumn(null)
    await flushPromises()

    expect(wrapper.text()).toContain(
      'セーフモードで起動中のためテーマは適用されていません',
    )
  })

  it('通常起動ではセーフモードの通知を出さない', async () => {
    const wrapper = mountColumn(null)
    await flushPromises()

    expect(wrapper.text()).not.toContain('セーフモードで起動中')
  })
})

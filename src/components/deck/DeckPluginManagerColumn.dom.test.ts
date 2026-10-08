// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { abortPlugin, launchPlugin } from '@/aiscript/plugin-api'
import { isExposed } from '@/settings/exposure'
import { useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { type StorePluginEntry, useMisStoreStore } from '@/stores/misstore'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import DeckPluginManagerColumn from './DeckPluginManagerColumn.vue'
import PluginCard from './PluginCard.vue'

/**
 * プラグイン管理カラムの UI ブロックの振る舞い (#1202 の 5 カラム統合の安全網)。
 * ストアは browser モード (isTauri=false、永続化は localStorage のみ)。
 */

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/aiscript/plugin-api', () => ({
  launchPlugin: vi.fn(async () => undefined),
  abortPlugin: vi.fn(),
  parsePluginMeta: vi.fn(() => null),
}))
vi.mock('@/settings/exposure', () => ({
  isExposed: vi.fn(() => false),
}))
vi.mock('@/stores/confirm', () => {
  const confirm = vi.fn(async () => true)
  return { useConfirm: () => ({ confirm }) }
})

const yami = {
  id: 'uuid-yami',
  host: 'yami.ski',
  userId: 'u1',
  username: 'hitalin',
  displayName: null,
  avatarUrl: null,
  software: 'misskey-dev/misskey' as const,
  hasToken: true,
}
const YAMI_KEY = 'yami.ski:u1'

function makePlugin(partial: Partial<PluginMeta>): PluginMeta {
  return {
    installId: partial.installId ?? `p-${Math.random().toString(36).slice(2)}`,
    name: partial.name ?? 'test-plugin',
    version: '1.0.0',
    configData: {},
    src: '### {}',
    active: true,
    ...partial,
  }
}

function makeStoreEntry(partial: Partial<StorePluginEntry>): StorePluginEntry {
  return {
    id: partial.id ?? 'store-entry',
    name: partial.name ?? 'Store Plugin',
    version: '1.0.0',
    author: 'someone',
    description: 'from store',
    category: 'utility',
    tags: [],
    sourceUrl: 'https://store.notedeck.io/x.is',
    apiUrl: 'https://store.notedeck.io/x.json',
    sha512: 'sha-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

/** レジストリ index の取得はネットワークに出さず固定の entries を返す */
let registryEntries: StorePluginEntry[] = []
interface FakeResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}
const registryOk = async (): Promise<FakeResponse> => ({
  ok: true,
  status: 200,
  json: async () => ({ plugins: registryEntries }),
  text: async () => '',
})
const fetchMock = vi.fn(registryOk)

function makeColumn(partial: Partial<DeckColumnType> = {}): DeckColumnType {
  return {
    id: 'col-plugins',
    type: 'pluginManager',
    name: null,
    width: 300,
    accountId: null,
    ...partial,
  }
}

type Wrapper = VueWrapper<InstanceType<typeof DeckPluginManagerColumn>>

async function mountColumn(column: Partial<DeckColumnType> = {}) {
  const wrapper = mount(DeckPluginManagerColumn, {
    props: { column: makeColumn(column) },
    global: {
      stubs: {
        // 本体のスロットだけ素通しして胴体を描画させる
        DeckColumn: {
          template: '<div><slot name="header-meta" /><slot /></div>',
        },
        SafeModeNotice: true,
        ColumnEmptyState: {
          props: ['message'],
          template: '<div>{{ message }}</div>',
        },
      },
    },
    attachTo: document.body,
  })
  await nextTick()
  return wrapper as Wrapper
}

function cards(wrapper: Wrapper, mode: 'installed' | 'store' | 'library') {
  return wrapper
    .findAllComponents(PluginCard)
    .filter((c) => c.props('mode') === mode)
}

/** mode のカードを 1 枚取る (無ければ失敗させる。非 null 断定の代わり) */
function card(
  wrapper: Wrapper,
  mode: 'installed' | 'store' | 'library',
  name?: string,
) {
  const found = cards(wrapper, mode).find(
    (c) => name === undefined || c.props('name') === name,
  )
  if (!found) throw new Error(`card not found: ${mode} ${name ?? ''}`)
  return found
}

function cardNames(wrapper: Wrapper, mode: 'installed' | 'store' | 'library') {
  return cards(wrapper, mode).map((c) => c.props('name') as string)
}

function buttonByText(
  scope: { findAll: (s: string) => ReturnType<Wrapper['findAll']> },
  text: string,
) {
  const btn = scope
    .findAll('button')
    .find((b) => b.text().trim() === text || b.text().includes(text))
  if (!btn) throw new Error(`button not found: ${text}`)
  return btn
}

function buttonByTitle(
  scope: { findAll: (s: string) => ReturnType<Wrapper['findAll']> },
  title: string,
) {
  const btn = scope
    .findAll('button')
    .find((b) => b.attributes('title') === title)
  if (!btn) throw new Error(`button not found (title): ${title}`)
  return btn
}

async function switchToStore(wrapper: Wrapper) {
  buttonByTitle(wrapper, 'ストア').trigger('click')
  await flush()
}

async function flush() {
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

async function setSearch(wrapper: Wrapper, value: string) {
  const input = wrapper.find('input[type="text"]')
  await input.setValue(value)
  await nextTick()
}

let wrapper: Wrapper | null = null

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  registryEntries = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(registryOk)
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(isExposed).mockReturnValue(false)
  vi.mocked(useConfirm().confirm).mockResolvedValue(true)
  vi.mocked(launchPlugin).mockClear()
  vi.mocked(abortPlugin).mockClear()
  const toast = useToast()
  for (const t of [...toast.toasts.value]) toast.dismiss(t.id)
  // アカウントを先に用意してからプラグインを足す (スコープ移行は空のまま 1 回で終わる)
  const accounts = useAccountsStore()
  accounts.accounts = [yami]
  accounts.isLoaded = true
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('DeckPluginManagerColumn — タブとスコープ', () => {
  it('インストール済みタブが初期表示で、ストアタブに切り替えるとストアの一覧に変わる', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({ installId: 'p1', name: 'alpha', global: true }),
    )
    registryEntries = [makeStoreEntry({ id: 'st-1', name: 'Store One' })]
    wrapper = await mountColumn()

    expect(wrapper.find('input').attributes('placeholder')).toBe(
      'インストール済みを探す',
    )
    expect(cardNames(wrapper, 'installed')).toEqual(['alpha'])
    expect(cards(wrapper, 'store')).toHaveLength(0)

    await switchToStore(wrapper)
    expect(wrapper.find('input').attributes('placeholder')).toBe('ストアを探す')
    expect(cards(wrapper, 'installed')).toHaveLength(0)
    expect(cardNames(wrapper, 'store')).toEqual(['Store One'])
  })

  it('全アカウントカラムは global 参加分だけを並べ、「外す」は全アカウント対象の文言になる', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({ installId: 'g', name: 'global-one', global: true }),
    )
    store.addPlugin(
      makePlugin({
        installId: 'a',
        name: 'yami-only',
        installedFor: [YAMI_KEY],
      }),
    )
    store.addPlugin(makePlugin({ installId: 'lib', name: 'library-only' }))
    wrapper = await mountColumn({ accountId: null })

    expect(cardNames(wrapper, 'installed')).toEqual(['global-one'])
    expect(buttonByTitle(wrapper, 'インストール済み 1').exists()).toBe(true)
    expect(cards(wrapper, 'installed')[0]?.props('detachTitle')).toBe(
      '全アカウント対象から外す',
    )
  })

  it('アカウントのカラムは当該アカウントのスコープ参加分だけを並べ、「外す」はアカウントの文言になる', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({ installId: 'g', name: 'global-one', global: true }),
    )
    store.addPlugin(
      makePlugin({
        installId: 'a',
        name: 'yami-only',
        installedFor: [YAMI_KEY],
      }),
    )
    store.addPlugin(
      makePlugin({
        installId: 'other',
        name: 'other-account',
        installedFor: ['misskey.cloud:u2'],
      }),
    )
    wrapper = await mountColumn({ accountId: yami.id })

    expect(cardNames(wrapper, 'installed')).toEqual(['yami-only'])
    expect(buttonByTitle(wrapper, 'インストール済み 1').exists()).toBe(true)
    expect(cards(wrapper, 'installed')[0]?.props('detachTitle')).toBe(
      'このアカウントから外す',
    )
  })

  it('サイドロードとストア配布をセクションで分け、0 件のセクションは出さない', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({ installId: 's', name: 'hand-made', global: true }),
    )
    store.addPlugin(
      makePlugin({
        installId: 'st',
        name: 'from-store',
        global: true,
        storeId: 'st-1',
      }),
    )
    wrapper = await mountColumn()
    const text = wrapper.text()
    expect(text).toContain('サイドロード')
    expect(text).toContain('ストア配布')

    store.removePlugin('st')
    await nextTick()
    expect(wrapper.text()).not.toContain('ストア配布')
  })
})

describe('DeckPluginManagerColumn — 絞り込み', () => {
  beforeEach(() => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({
        installId: 'on',
        name: 'clock',
        global: true,
        active: true,
      }),
    )
    store.addPlugin(
      makePlugin({
        installId: 'off',
        name: 'weather',
        global: true,
        active: false,
        author: 'alice',
      }),
    )
  })

  it('@enabled を打つと有効なものだけ、@disabled なら無効なものだけに絞る', async () => {
    wrapper = await mountColumn()
    expect(cardNames(wrapper, 'installed')).toEqual(['clock', 'weather'])

    await setSearch(wrapper, '@enabled ')
    expect(cardNames(wrapper, 'installed')).toEqual(['clock'])

    await setSearch(wrapper, '@disabled ')
    expect(cardNames(wrapper, 'installed')).toEqual(['weather'])
  })

  it('フィルターボタンを押すと検索欄に接頭辞が入り、同じ絞り込みになる', async () => {
    wrapper = await mountColumn()
    await buttonByTitle(wrapper, '無効なプラグイン').trigger('click')
    await nextTick()
    expect(
      (wrapper.find('input[type="text"]').element as HTMLInputElement).value,
    ).toBe('@disabled ')
    expect(cardNames(wrapper, 'installed')).toEqual(['weather'])
  })

  it('文字検索は名前・説明・作者に部分一致し、接頭辞と組み合わせられる', async () => {
    wrapper = await mountColumn()
    await setSearch(wrapper, 'ALI')
    expect(cardNames(wrapper, 'installed')).toEqual(['weather'])

    await setSearch(wrapper, '@enabled clo')
    expect(cardNames(wrapper, 'installed')).toEqual(['clock'])

    await setSearch(wrapper, '@enabled weather')
    expect(cardNames(wrapper, 'installed')).toEqual([])
    expect(wrapper.text()).toContain('一致するプラグインがありません')
  })

  it('スコープに 1 件も無いときは空状態の案内を出す', async () => {
    wrapper = await mountColumn({ accountId: yami.id })
    expect(cards(wrapper, 'installed')).toHaveLength(0)
    expect(wrapper.text()).toContain(
      'このカラムに追加されたプラグインはありません',
    )
  })
})

describe('DeckPluginManagerColumn — 有効/無効の切り替え', () => {
  it('無効なプラグインを「有効にする」と setActive(true) の後に起動する', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({
        installId: 'p1',
        name: 'alpha',
        global: true,
        active: false,
      }),
    )
    const setActive = vi.spyOn(store, 'setActive')
    wrapper = await mountColumn()

    await buttonByText(card(wrapper, 'installed'), '有効にする').trigger(
      'click',
    )
    await flush()

    expect(setActive).toHaveBeenCalledWith('p1', true)
    expect(store.plugins[0]?.active).toBe(true)
    expect(launchPlugin).toHaveBeenCalledTimes(1)
    expect(vi.mocked(launchPlugin).mock.calls[0]?.[0]?.installId).toBe('p1')
    expect(abortPlugin).not.toHaveBeenCalled()
  })

  it('有効なプラグインを「無効にする」と setActive(false) の後に停止する', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({
        installId: 'p1',
        name: 'alpha',
        global: true,
        active: true,
      }),
    )
    const setActive = vi.spyOn(store, 'setActive')
    wrapper = await mountColumn()

    await buttonByText(card(wrapper, 'installed'), '無効にする').trigger(
      'click',
    )
    await flush()

    expect(setActive).toHaveBeenCalledWith('p1', false)
    expect(store.plugins[0]?.active).toBe(false)
    expect(abortPlugin).toHaveBeenCalledWith('p1')
    expect(launchPlugin).not.toHaveBeenCalled()
  })

  it('読取専用 (ソース欠損) のプラグインは切り替えを拒み、理由を警告トーストで出して起動しない', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({
        installId: 'ro',
        name: 'orphan',
        global: true,
        active: false,
        readOnly: true,
      }),
    )
    wrapper = await mountColumn()
    expect(wrapper.text()).toContain('ソース欠損')

    await buttonByText(card(wrapper, 'installed'), '有効にする').trigger(
      'click',
    )
    await flush()

    expect(store.plugins[0]?.active).toBe(false)
    expect(launchPlugin).not.toHaveBeenCalled()
    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.type).toBe('warning')
    expect(toasts[0]?.text).toBe(
      'ソースファイルが見つからないため変更できません',
    )
  })
})

describe('DeckPluginManagerColumn — スコープから外す', () => {
  it('「外す」はスコープ参照だけ外して本体をライブラリに残し、元に戻すトーストで復帰できる', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({ installId: 'p1', name: 'alpha', global: true }),
    )
    wrapper = await mountColumn()

    await buttonByTitle(
      card(wrapper, 'installed'),
      '全アカウント対象から外す',
    ).trigger('click')
    await nextTick()

    expect(cards(wrapper, 'installed')).toHaveLength(0)
    expect(store.plugins).toHaveLength(1)
    expect(store.plugins[0]?.global).toBeUndefined()
    expect(useConfirm().confirm).not.toHaveBeenCalled()

    const toast = useToast().toasts.value[0]
    expect(toast?.text).toBe('プラグインを外しました')
    expect(toast?.action?.label).toBe('元に戻す')
    toast?.action?.onClick()
    await nextTick()
    expect(store.plugins[0]?.global).toBe(true)
    expect(cardNames(wrapper, 'installed')).toEqual(['alpha'])
  })

  it('アカウントのカラムで「外す」とそのアカウントの参照だけ消え、他アカウントの参照は残る', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({
        installId: 'p1',
        name: 'alpha',
        installedFor: [YAMI_KEY, 'misskey.cloud:u2'],
      }),
    )
    wrapper = await mountColumn({ accountId: yami.id })

    await buttonByTitle(
      card(wrapper, 'installed'),
      'このアカウントから外す',
    ).trigger('click')
    await nextTick()

    expect(cards(wrapper, 'installed')).toHaveLength(0)
    expect(store.plugins[0]?.installedFor).toEqual(['misskey.cloud:u2'])
  })

  it('読取専用のプラグインは外せず、理由を警告トーストで出す', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({
        installId: 'ro',
        name: 'orphan',
        global: true,
        readOnly: true,
      }),
    )
    wrapper = await mountColumn()

    await buttonByTitle(
      card(wrapper, 'installed'),
      '全アカウント対象から外す',
    ).trigger('click')
    await nextTick()

    expect(store.plugins[0]?.global).toBe(true)
    expect(cardNames(wrapper, 'installed')).toEqual(['orphan'])
    expect(useToast().toasts.value[0]?.type).toBe('warning')
  })
})

describe('DeckPluginManagerColumn — ライブラリピッカー', () => {
  it('「ライブラリから追加」でスコープ未参加の本体だけが候補に出て、「追加」でスコープに入る', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({ installId: 'in', name: 'in-scope', global: true }),
    )
    store.addPlugin(makePlugin({ installId: 'lib', name: 'library-only' }))
    wrapper = await mountColumn()
    expect(cards(wrapper, 'library')).toHaveLength(0)

    await buttonByText(wrapper, 'ライブラリから追加').trigger('click')
    await nextTick()
    expect(cardNames(wrapper, 'library')).toEqual(['library-only'])

    await buttonByText(card(wrapper, 'library'), '追加').trigger('click')
    await nextTick()
    expect(store.plugins.find((p) => p.installId === 'lib')?.global).toBe(true)
    expect(cardNames(wrapper, 'installed')).toEqual([
      'in-scope',
      'library-only',
    ])
    // 追加したらピッカーは閉じる
    expect(cards(wrapper, 'library')).toHaveLength(0)
  })

  it('ライブラリからの削除は確認してから本体を消し、元に戻すトーストで復帰できる', async () => {
    const store = usePluginsStore()
    store.addPlugin(makePlugin({ installId: 'lib', name: 'library-only' }))
    wrapper = await mountColumn()
    await buttonByText(wrapper, 'ライブラリから追加').trigger('click')
    await nextTick()

    await buttonByTitle(
      card(wrapper, 'library'),
      'ライブラリから削除 (コードも消えます)',
    ).trigger('click')
    await flush()

    const { confirm } = useConfirm()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({
      type: 'danger',
      message:
        '「library-only」をライブラリから削除しますか？プラグインのコードも消えます。',
    })
    expect(abortPlugin).toHaveBeenCalledWith('lib')
    expect(store.plugins).toHaveLength(0)
    expect(cards(wrapper, 'library')).toHaveLength(0)

    const toast = useToast().toasts.value[0]
    expect(toast?.text).toBe('プラグインを削除しました')
    expect(toast?.action?.label).toBe('元に戻す')
    toast?.action?.onClick()
    await nextTick()
    expect(store.plugins.map((p) => p.installId)).toEqual(['lib'])
    expect(cardNames(wrapper, 'library')).toEqual(['library-only'])
  })

  it('削除の確認をキャンセルすると何も消えない', async () => {
    const store = usePluginsStore()
    store.addPlugin(makePlugin({ installId: 'lib', name: 'library-only' }))
    vi.mocked(useConfirm().confirm).mockResolvedValue(false)
    wrapper = await mountColumn()
    await buttonByText(wrapper, 'ライブラリから追加').trigger('click')
    await nextTick()

    await buttonByTitle(
      card(wrapper, 'library'),
      'ライブラリから削除 (コードも消えます)',
    ).trigger('click')
    await flush()

    expect(store.plugins).toHaveLength(1)
    expect(abortPlugin).not.toHaveBeenCalled()
    expect(useToast().toasts.value).toHaveLength(0)
  })
})

describe('DeckPluginManagerColumn — 編集ウィンドウ', () => {
  it('新規作成ボタンは開発者モードのときだけ出て、押すとカラムのスコープ付きで編集ウィンドウを開く', async () => {
    wrapper = await mountColumn()
    expect(
      wrapper
        .findAll('button')
        .some((b) => b.attributes('title') === '新規プラグインを作成'),
    ).toBe(false)
    wrapper.unmount()

    vi.mocked(isExposed).mockImplementation((tag) => tag === 'developer')
    const open = vi.spyOn(useWindowsStore(), 'open').mockReturnValue('win-1')
    wrapper = await mountColumn({ accountId: yami.id })
    await buttonByTitle(wrapper, '新規プラグインを作成').trigger('click')

    expect(open).toHaveBeenCalledWith('plugins', {
      initialScope: { kind: 'account', key: YAMI_KEY },
    })
  })

  it('カードを開くと installId とスコープを渡して編集ウィンドウを開く', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({ installId: 'p1', name: 'alpha', global: true }),
    )
    const open = vi.spyOn(useWindowsStore(), 'open').mockReturnValue('win-1')
    wrapper = await mountColumn()

    await buttonByText(card(wrapper, 'installed'), 'alpha').trigger('click')
    expect(open).toHaveBeenCalledWith('plugins', {
      initialPluginId: 'p1',
      initialScope: { kind: 'global' },
    })

    open.mockClear()
    await buttonByTitle(card(wrapper, 'installed'), '設定').trigger('click')
    expect(open).toHaveBeenCalledWith('plugins', {
      initialPluginId: 'p1',
      initialScope: { kind: 'global' },
    })
  })
})

describe('DeckPluginManagerColumn — ストアタブ', () => {
  it('このスコープに入っている entry は「インストール済み」、入っていなければ「インストール」を出す', async () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({
        installId: 'in',
        name: 'in-scope',
        global: true,
        storeId: 'st-in',
        storeSha512: 'sha-1',
      }),
    )
    store.addPlugin(
      makePlugin({
        installId: 'elsewhere',
        name: 'other-scope',
        installedFor: ['misskey.cloud:u2'],
        storeId: 'st-elsewhere',
        storeSha512: 'sha-1',
      }),
    )
    registryEntries = [
      makeStoreEntry({ id: 'st-in', name: 'In Scope' }),
      makeStoreEntry({ id: 'st-elsewhere', name: 'Elsewhere' }),
      makeStoreEntry({ id: 'st-new', name: 'Brand New' }),
    ]
    wrapper = await mountColumn()
    await switchToStore(wrapper)

    expect(fetchMock).toHaveBeenCalled()
    const byName = new Map(
      cards(wrapper, 'store').map((c) => [c.props('name'), c]),
    )
    expect([...byName.keys()]).toEqual(['In Scope', 'Elsewhere', 'Brand New'])
    expect(byName.get('In Scope')?.props('alreadyInstalled')).toBe(true)
    expect(byName.get('In Scope')?.text()).toContain('インストール済み')
    // ライブラリにはあるがこのスコープに未参加 → インストール (= スコープへ参照追加) を出す
    expect(byName.get('Elsewhere')?.props('alreadyInstalled')).toBe(false)
    expect(
      buttonByText(
        card(wrapper, 'store', 'Elsewhere'),
        'インストール',
      ).exists(),
    ).toBe(true)
    expect(
      buttonByText(
        card(wrapper, 'store', 'Brand New'),
        'インストール',
      ).exists(),
    ).toBe(true)
  })

  it('「インストール」を押すとカラムのスコープを添えて installPlugin を呼ぶ', async () => {
    registryEntries = [makeStoreEntry({ id: 'st-new', name: 'Brand New' })]
    const misStore = useMisStoreStore()
    const install = vi.spyOn(misStore, 'installPlugin').mockResolvedValue()
    wrapper = await mountColumn({ accountId: yami.id })
    await switchToStore(wrapper)

    await buttonByText(card(wrapper, 'store'), 'インストール').trigger('click')
    await flush()

    expect(install).toHaveBeenCalledTimes(1)
    expect(install.mock.calls[0]?.[0]?.id).toBe('st-new')
    expect(install.mock.calls[0]?.[1]).toEqual({
      kind: 'account',
      key: YAMI_KEY,
    })
  })

  it('インストールに失敗するとエラー行を出し、閉じるで消える', async () => {
    registryEntries = [makeStoreEntry({ id: 'st-new', name: 'Brand New' })]
    vi.spyOn(useMisStoreStore(), 'installPlugin').mockRejectedValue(
      new Error('boom'),
    )
    wrapper = await mountColumn()
    await switchToStore(wrapper)

    await buttonByText(card(wrapper, 'store'), 'インストール').trigger('click')
    await flush()
    expect(wrapper.text()).toContain('boom')

    const errorRow = wrapper
      .findAll('div')
      .find((d) => d.text().startsWith('boom'))
    await errorRow?.find('button').trigger('click')
    await nextTick()
    expect(wrapper.text()).not.toContain('boom')
  })

  it('ストアの検索欄は名前・説明・作者・タグで絞り込む', async () => {
    registryEntries = [
      makeStoreEntry({ id: 'a', name: 'Alpha', tags: ['timeline'] }),
      makeStoreEntry({ id: 'b', name: 'Beta', description: 'reaction helper' }),
    ]
    wrapper = await mountColumn()
    await switchToStore(wrapper)

    await setSearch(wrapper, 'timeline')
    expect(cardNames(wrapper, 'store')).toEqual(['Alpha'])
    await setSearch(wrapper, 'REACTION')
    expect(cardNames(wrapper, 'store')).toEqual(['Beta'])
    await setSearch(wrapper, 'zzz')
    expect(cardNames(wrapper, 'store')).toEqual([])
    expect(wrapper.text()).toContain('一致するプラグインがありません')
  })

  it('レジストリの取得に失敗すると接続不可の案内と再試行ボタンを出す', async () => {
    // 取得は mount 時とタブ切替時の 2 回走る (失敗時は TTL が残らず再取得する)
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => '',
    }))
    wrapper = await mountColumn()
    await switchToStore(wrapper)
    expect(wrapper.text()).toContain('ストアに接続できません')
    expect(buttonByText(wrapper, '再試行').exists()).toBe(true)
  })
})

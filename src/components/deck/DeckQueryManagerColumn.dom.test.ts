// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

/**
 * クエリ管理カラム (#783 Phase 1.5) の UI ブロックの振る舞い。
 * 5 つの配布物管理カラムを統一する (#1202) 前の安全網。
 * テスト環境は isTauri=false なので store は localStorage ミラーだけで動く。
 */

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: false }
})
vi.mock('@/services/columnQuery/degradedRunner', () => ({
  releaseSharedSuspension: vi.fn(),
}))
vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/utils/url', () => ({
  openSafeUrl: vi.fn(async () => undefined),
}))

const confirmMock = vi.fn<(opts: unknown) => Promise<boolean>>(async () => true)
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}))

const isWindowExposedMock = vi.fn<(type: string) => boolean>(() => true)
vi.mock('@/windows/exposure', () => ({
  isWindowExposed: (type: string) => isWindowExposedMock(type),
}))

const readSafeModeMock = vi.fn<() => boolean>(() => false)
vi.mock('@/utils/safeMode', () => ({
  readSafeMode: () => readSafeModeMock(),
}))

import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
  type NamedQueryMeta,
  type QueryScope,
  useColumnQueriesStore,
} from '@/stores/columnQueries'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import { type StoreQueryEntry, useMisStoreStore } from '@/stores/misstore'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import DeckQueryManagerColumn from './DeckQueryManagerColumn.vue'
import QueryCard from './QueryCard.vue'

const READ_ONLY_REASON = 'ソースファイルが見つからないため変更できません'

const alice = {
  id: 'acc-alice',
  host: 'misskey.example',
  userId: 'u-alice',
  username: 'alice',
  displayName: null,
  avatarUrl: null,
  software: 'misskey-dev/misskey' as const,
  hasToken: true,
}
const aliceScope: QueryScope = { kind: 'account', key: accountScopeKey(alice) }
const globalScope: QueryScope = { kind: 'global' }

function makeColumn(accountId: string | null): DeckColumnType {
  return {
    id: `col-qm-${accountId ?? 'global'}`,
    type: 'queryManager',
    name: null,
    width: 320,
    accountId,
  }
}

function makeStoreEntry(
  overrides: Partial<StoreQueryEntry> = {},
): StoreQueryEntry {
  return {
    id: 'no-federation',
    name: 'No Federation',
    version: '1.0.0',
    author: 'store-author',
    description: '連合しないノートだけ',
    category: 'focus',
    tags: ['local'],
    sourceUrl: 'https://store.notedeck.io/q/no-federation.is',
    apiUrl: 'https://store.notedeck.io/api/q/no-federation',
    sha512: 'deadbeef',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 店先の feed は fetch をスタブして registry JSON を返す (ネットワーク無し) */
function stubRegistry(entries: StoreQueryEntry[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ queries: entries }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function seedQuery(
  input: { name: string; src?: string; scope?: QueryScope } & Partial<
    Pick<NamedQueryMeta, 'description' | 'storeId' | 'disabled' | 'readOnly'>
  >,
): Promise<NamedQueryMeta> {
  const store = useColumnQueriesStore()
  const { disabled, readOnly, src, ...rest } = input
  const created = await store.createQuery({
    src: src ?? 'note.text != null',
    ...rest,
  })
  if (disabled) await store.setDisabled(created.id, true)
  if (readOnly) {
    // ソース欠損の読取専用個体 (#1111) は sidecar 読込でしか生まれないので直接印を付ける
    store.queries = store.queries.map((q) =>
      q.id === created.id ? { ...q, readOnly: true } : q,
    )
  }
  const live = store.getQuery(created.id)
  if (!live) throw new Error('seed failed')
  return live
}

function mountColumn(column: DeckColumnType) {
  return mount(DeckQueryManagerColumn, {
    props: { column },
    attachTo: document.body,
    global: {
      stubs: {
        DeckColumn: {
          template:
            '<div class="deck-column-stub"><div class="header-meta"><slot name="header-meta" /></div><slot /></div>',
        },
        ColumnTabs: {
          props: ['tabs', 'modelValue'],
          emits: ['update:modelValue'],
          template:
            '<div class="column-tabs-stub"><button v-for="t in tabs" :key="t.value" class="tab" :data-tab="t.value" @click="$emit(\'update:modelValue\', t.value)">{{ t.label }}</button></div>',
        },
      },
    },
  })
}

type Wrapper = VueWrapper<InstanceType<typeof DeckQueryManagerColumn>>

function cardNames(wrapper: Wrapper): string[] {
  return wrapper
    .findAllComponents(QueryCard)
    .map((c) => c.props('name') as string)
}

function cardByName(wrapper: Wrapper, name: string) {
  const card = wrapper
    .findAllComponents(QueryCard)
    .find((c) => c.props('name') === name)
  if (!card) throw new Error(`card not found: ${name}`)
  return card
}

function buttonByTitle(root: { findAll: Wrapper['findAll'] }, title: string) {
  const btn = root
    .findAll('button')
    .find((b) => b.attributes('title') === title)
  if (!btn) throw new Error(`button not found: ${title}`)
  return btn
}

function buttonByText(root: { findAll: Wrapper['findAll'] }, text: string) {
  const btn = root.findAll('button').find((b) => b.text().includes(text))
  if (!btn) throw new Error(`button not found: ${text}`)
  return btn
}

async function setSearch(wrapper: Wrapper, value: string) {
  await wrapper.find('input[type="text"]').setValue(value)
  await nextTick()
}

let mounted: Wrapper[] = []

describe('DeckQueryManagerColumn', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    confirmMock.mockReset()
    confirmMock.mockResolvedValue(true)
    isWindowExposedMock.mockReset()
    isWindowExposedMock.mockReturnValue(true)
    readSafeModeMock.mockReset()
    readSafeModeMock.mockReturnValue(false)
    stubRegistry([])
    const toast = useToast()
    for (const item of [...toast.toasts.value]) toast.dismiss(item.id)
    const accounts = useAccountsStore()
    accounts.accounts = [alice]
    accounts.isLoaded = true
  })

  afterEach(() => {
    for (const w of mounted) w.unmount()
    mounted = []
    vi.unstubAllGlobals()
  })

  function open(column: DeckColumnType): Wrapper {
    const w = mountColumn(column)
    mounted.push(w)
    return w
  }

  it('タブを切り替えると、導入済みは件数つきラベルで一覧を出し、ストアは feed を取りに行ってカードを出す', async () => {
    await seedQuery({ name: 'Global A', scope: globalScope })
    const fetchMock = stubRegistry([makeStoreEntry()])
    const wrapper = open(makeColumn(null))
    await flushPromises()

    expect(wrapper.find('[data-tab="installed"]').text()).toBe(
      'インストール済み 1',
    )
    expect(cardNames(wrapper)).toEqual(['Global A'])
    expect(fetchMock).not.toHaveBeenCalled()
    // 導入済みタブだけ有効/無効の絞り込みボタンを持つ
    expect(wrapper.findAll('button[title="有効なクエリ"]')).toHaveLength(1)

    await wrapper.find('[data-tab="store"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cardNames(wrapper)).toEqual(['No Federation'])
    expect(cardByName(wrapper, 'No Federation').props('mode')).toBe('store')
    expect(wrapper.findAll('button[title="有効なクエリ"]')).toHaveLength(0)
  })

  it('全アカウントのカラムは全体スコープの本体だけ、アカウントのカラムはそのアカウントに参加している本体だけを並べる', async () => {
    await seedQuery({ name: 'Global only', scope: globalScope })
    await seedQuery({ name: 'Alice only', scope: aliceScope })
    await seedQuery({ name: 'Library only' })
    await seedQuery({
      name: 'Bob only',
      scope: { kind: 'account', key: 'other.example:u-bob' },
    })

    const globalWrapper = open(makeColumn(null))
    await flushPromises()
    expect(cardNames(globalWrapper)).toEqual(['Global only'])

    const aliceWrapper = open(makeColumn(alice.id))
    await flushPromises()
    expect(cardNames(aliceWrapper)).toEqual(['Alice only'])
  })

  it('アカウントが見つからないカラムはどの本体も並べず、ライブラリからの追加候補も出さない', async () => {
    await seedQuery({ name: 'Global only', scope: globalScope })
    const wrapper = open(makeColumn('acc-logged-out'))
    await flushPromises()

    expect(cardNames(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('名前付きクエリはまだありません')
  })

  it('検索欄に @enabled / @disabled を付けると有効・無効で絞り込み、続く語は名前と説明で絞り込む', async () => {
    await seedQuery({ name: 'Alpha', scope: globalScope })
    await seedQuery({
      name: 'Beta',
      description: 'alpha を含む説明',
      scope: globalScope,
    })
    await seedQuery({ name: 'Gamma', scope: globalScope, disabled: true })
    const wrapper = open(makeColumn(null))
    await flushPromises()
    expect(cardNames(wrapper)).toHaveLength(3)

    await setSearch(wrapper, '@enabled')
    expect(cardNames(wrapper).sort()).toEqual(['Alpha', 'Beta'])

    await setSearch(wrapper, '@disabled')
    expect(cardNames(wrapper)).toEqual(['Gamma'])

    await setSearch(wrapper, '@enabled alpha')
    expect(cardNames(wrapper).sort()).toEqual(['Alpha', 'Beta'])

    await setSearch(wrapper, 'gam')
    expect(cardNames(wrapper)).toEqual(['Gamma'])

    await setSearch(wrapper, 'nothing-matches')
    expect(cardNames(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('一致するクエリがありません')
  })

  it('絞り込みボタンを押すと検索欄に接頭辞が入り、もう一度押すと解除される', async () => {
    await seedQuery({ name: 'On', scope: globalScope })
    await seedQuery({ name: 'Off', scope: globalScope, disabled: true })
    const wrapper = open(makeColumn(null))
    await flushPromises()

    await wrapper.find('button[title="無効なクエリ"]').trigger('click')
    await nextTick()
    const input = wrapper.find('input[type="text"]').element as HTMLInputElement
    expect(input.value).toBe('@disabled ')
    expect(cardNames(wrapper)).toEqual(['Off'])

    await wrapper.find('button[title="無効なクエリ"]').trigger('click')
    await nextTick()
    expect(input.value).toBe('')
    expect(cardNames(wrapper)).toHaveLength(2)
  })

  it('カードの「無効にする」を押すと本体が無効になり、「有効にする」で戻る', async () => {
    const q = await seedQuery({ name: 'Toggle me', scope: globalScope })
    const store = useColumnQueriesStore()
    const wrapper = open(makeColumn(null))
    await flushPromises()

    await buttonByText(cardByName(wrapper, 'Toggle me'), '無効にする').trigger(
      'click',
    )
    await flushPromises()
    expect(store.getQuery(q.id)?.disabled).toBe(true)
    expect(cardByName(wrapper, 'Toggle me').props('disabled')).toBe(true)
    expect(cardByName(wrapper, 'Toggle me').text()).toContain('無効')

    await buttonByText(cardByName(wrapper, 'Toggle me'), '有効にする').trigger(
      'click',
    )
    await flushPromises()
    expect(store.getQuery(q.id)?.disabled).toBeUndefined()
    expect(cardByName(wrapper, 'Toggle me').props('disabled')).toBe(false)
  })

  it('適用中のカラム数は noteQueryRefs の集計で「N カラムで適用中」と出る', async () => {
    const q = await seedQuery({ name: 'Applied', scope: globalScope })
    await seedQuery({ name: 'Unused', scope: globalScope })
    const deck = useDeckStore()
    deck.columns.push(
      {
        id: 'tl-1',
        type: 'timeline',
        name: null,
        width: 300,
        accountId: alice.id,
        noteQueryRefs: [q.id],
      },
      {
        id: 'tl-2',
        type: 'timeline',
        name: null,
        width: 300,
        accountId: alice.id,
        noteQueryRefs: [q.id, 'missing'],
      },
    )
    const wrapper = open(makeColumn(null))
    await flushPromises()

    expect(cardByName(wrapper, 'Applied').props('refCount')).toBe(2)
    expect(cardByName(wrapper, 'Applied').text()).toContain('2 カラムで適用中')
    expect(cardByName(wrapper, 'Unused').props('refCount')).toBe(0)
    expect(cardByName(wrapper, 'Unused').text()).not.toContain('カラムで適用中')
  })

  it('削除は確認 → removeQuery → 「元に戻す」つきトーストで、戻すと本体が復活する', async () => {
    const q = await seedQuery({ name: 'Doomed', scope: globalScope })
    const store = useColumnQueriesStore()
    const toast = useToast()
    const wrapper = open(makeColumn(null))
    await flushPromises()

    await buttonByTitle(
      cardByName(wrapper, 'Doomed'),
      'ライブラリから削除 (本文も消えます)',
    ).trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0]?.[0]).toMatchObject({
      title: 'クエリを削除',
      message: '「Doomed」を削除しますか？クエリの本文も消えます。',
      type: 'danger',
    })
    expect(store.getQuery(q.id)).toBeUndefined()
    expect(cardNames(wrapper)).toEqual([])

    const item = toast.toasts.value.find(
      (t) => t.text === 'クエリを削除しました',
    )
    expect(item?.action?.label).toBe('元に戻す')
    if (!item) throw new Error('toast missing')
    toast.runAction(item)
    await flushPromises()

    expect(store.getQuery(q.id)?.name).toBe('Doomed')
    expect(cardNames(wrapper)).toEqual(['Doomed'])
  })

  it('適用中の本体を削除するときは適用先カラム数を添えて確認し、キャンセルなら消さない', async () => {
    const q = await seedQuery({ name: 'In use', scope: globalScope })
    useDeckStore().columns.push({
      id: 'tl-1',
      type: 'timeline',
      name: null,
      width: 300,
      accountId: alice.id,
      noteQueryRefs: [q.id],
    })
    confirmMock.mockResolvedValue(false)
    const store = useColumnQueriesStore()
    const wrapper = open(makeColumn(null))
    await flushPromises()

    await buttonByTitle(
      cardByName(wrapper, 'In use'),
      'ライブラリから削除 (本文も消えます)',
    ).trigger('click')
    await flushPromises()

    expect(confirmMock.mock.calls[0]?.[0]).toMatchObject({
      message:
        '「In use」は 1 個のカラムに適用中です。削除するとそれらのカラムは評価不能 (fail-closed) になります。削除しますか？',
    })
    expect(store.getQuery(q.id)).toBeDefined()
    expect(cardNames(wrapper)).toEqual(['In use'])
    expect(useToast().toasts.value).toHaveLength(0)
  })

  it('「外す」はスコープから外すだけで本体はライブラリに残り、トーストの「元に戻す」で参加に戻る', async () => {
    const q = await seedQuery({ name: 'Detach me', scope: aliceScope })
    const store = useColumnQueriesStore()
    const toast = useToast()
    const wrapper = open(makeColumn(alice.id))
    await flushPromises()

    await buttonByTitle(
      cardByName(wrapper, 'Detach me'),
      'このアカウントから外す',
    ).trigger('click')
    await flushPromises()

    expect(confirmMock).not.toHaveBeenCalled()
    expect(store.getQuery(q.id)?.installedFor).toBeUndefined()
    expect(store.getQuery(q.id)?.name).toBe('Detach me')
    expect(cardNames(wrapper)).toEqual([])

    const item = toast.toasts.value.find((t) => t.text === 'クエリを外しました')
    expect(item?.action?.label).toBe('元に戻す')
    if (!item) throw new Error('toast missing')
    toast.runAction(item)
    await flushPromises()

    expect(store.getQuery(q.id)?.installedFor).toEqual([aliceScope.key])
    expect(cardNames(wrapper)).toEqual(['Detach me'])
  })

  it('全アカウントのカラムの「外す」は全体スコープから外し、tooltip もその文言になる', async () => {
    const q = await seedQuery({ name: 'Global detach', scope: globalScope })
    const store = useColumnQueriesStore()
    const wrapper = open(makeColumn(null))
    await flushPromises()

    await buttonByTitle(
      cardByName(wrapper, 'Global detach'),
      '全アカウント対象から外す',
    ).trigger('click')
    await flushPromises()

    expect(store.getQuery(q.id)?.global).toBeUndefined()
    expect(cardNames(wrapper)).toEqual([])
  })

  it('ソース欠損の読取専用な本体は「ソース欠損」バッジを出し、外す・有効/無効の変更は理由つき警告で拒まれる', async () => {
    const q = await seedQuery({
      name: 'Read only',
      scope: globalScope,
      readOnly: true,
    })
    const store = useColumnQueriesStore()
    const toast = useToast()
    const wrapper = open(makeColumn(null))
    await flushPromises()

    const card = cardByName(wrapper, 'Read only')
    expect(card.text()).toContain('ソース欠損')
    expect(
      (buttonByText(card, '無効にする').element as HTMLButtonElement).disabled,
    ).toBe(true)

    await buttonByTitle(card, '全アカウント対象から外す').trigger('click')
    await flushPromises()
    expect(store.getQuery(q.id)?.global).toBe(true)
    expect(cardNames(wrapper)).toEqual(['Read only'])
    expect(toast.toasts.value).toMatchObject([
      { text: READ_ONLY_REASON, type: 'warning' },
    ])

    // ボタンは無効だが、イベント経路でも store が拒否して理由を出す
    for (const item of [...toast.toasts.value]) toast.dismiss(item.id)
    card.vm.$emit('toggle')
    await flushPromises()
    expect(store.getQuery(q.id)?.disabled).toBeUndefined()
    expect(toast.toasts.value).toMatchObject([
      { text: READ_ONLY_REASON, type: 'warning' },
    ])
  })

  it('新規作成はカラムのスコープに参加した状態で作り、エディタウィンドウを開く', async () => {
    const store = useColumnQueriesStore()
    const openSpy = vi.spyOn(useWindowsStore(), 'open')
    const wrapper = open(makeColumn(alice.id))
    await flushPromises()

    expect(wrapper.text()).toContain('名前付きクエリはまだありません')
    await buttonByTitle(wrapper, '新規クエリを作成').trigger('click')
    await flushPromises()

    expect(store.queries).toHaveLength(1)
    const created = store.queries[0]
    expect(created).toMatchObject({
      name: '新しいクエリ 1',
      installedFor: [aliceScope.key],
      scoped: true,
    })
    expect(created?.global).toBeUndefined()
    expect(created?.src).toContain('キーワード')
    expect(openSpy).toHaveBeenCalledWith('column-query-editor', {
      queryId: created?.id,
    })
    expect(cardNames(wrapper)).toEqual(['新しいクエリ 1'])
  })

  it('全アカウントのカラムで新規作成すると全体スコープで作る', async () => {
    const store = useColumnQueriesStore()
    vi.spyOn(useWindowsStore(), 'open')
    const wrapper = open(makeColumn(null))
    await flushPromises()

    await buttonByText(wrapper, 'クエリを作成').trigger('click')
    await flushPromises()

    expect(store.queries[0]).toMatchObject({ global: true, scoped: true })
    expect(store.queries[0]?.installedFor).toBeUndefined()
  })

  it('エディタが露出していないときは作成ボタンと編集ボタンを出さない', async () => {
    isWindowExposedMock.mockReturnValue(false)
    await seedQuery({ name: 'Plain', scope: globalScope })
    const openSpy = vi.spyOn(useWindowsStore(), 'open')
    const wrapper = open(makeColumn(null))
    await flushPromises()

    expect(isWindowExposedMock).toHaveBeenCalledWith('column-query-editor')
    expect(
      wrapper
        .findAll('button')
        .some((b) => b.attributes('title') === '新規クエリを作成'),
    ).toBe(false)
    expect(
      wrapper.findAll('button').some((b) => b.text().includes('クエリを作成')),
    ).toBe(false)
    const card = cardByName(wrapper, 'Plain')
    expect(card.findAll('button').some((b) => b.text().includes('編集'))).toBe(
      false,
    )
    // 名前はボタンではなく素のテキストになり、押してもエディタは開かない
    expect(card.find('button.name').exists()).toBe(false)
    await card.trigger('click')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('露出しているときはカードの「編集」でそのクエリのエディタを開く', async () => {
    const q = await seedQuery({ name: 'Editable', scope: globalScope })
    const openSpy = vi.spyOn(useWindowsStore(), 'open')
    const wrapper = open(makeColumn(null))
    await flushPromises()

    await buttonByText(cardByName(wrapper, 'Editable'), '編集').trigger('click')
    expect(openSpy).toHaveBeenCalledWith('column-query-editor', {
      queryId: q.id,
    })
  })

  it('ライブラリピッカーはこのスコープに未参加の本体だけを並べ、「追加」で参加させて閉じる', async () => {
    await seedQuery({ name: 'Already here', scope: aliceScope })
    const lib = await seedQuery({ name: 'In library' })
    const other = await seedQuery({ name: 'Global one', scope: globalScope })
    const store = useColumnQueriesStore()
    const wrapper = open(makeColumn(alice.id))
    await flushPromises()

    expect(cardNames(wrapper)).toEqual(['Already here'])
    await buttonByText(wrapper, 'ライブラリから追加').trigger('click')
    await nextTick()

    const pickerCards = wrapper
      .findAllComponents(QueryCard)
      .filter((c) => c.props('mode') === 'library')
    expect(pickerCards.map((c) => c.props('name')).sort()).toEqual([
      'Global one',
      'In library',
    ])
    expect(buttonByText(wrapper, '閉じる').exists()).toBe(true)

    await buttonByText(cardByName(wrapper, 'In library'), '追加').trigger(
      'click',
    )
    await flushPromises()

    expect(store.getQuery(lib.id)?.installedFor).toEqual([aliceScope.key])
    expect(store.getQuery(other.id)?.installedFor).toBeUndefined()
    expect(
      wrapper
        .findAllComponents(QueryCard)
        .filter((c) => c.props('mode') === 'library'),
    ).toHaveLength(0)
    expect(cardNames(wrapper).sort()).toEqual(['Already here', 'In library'])
    expect(buttonByText(wrapper, 'ライブラリから追加').exists()).toBe(true)
  })

  it('ライブラリに追加候補が無ければピッカーは空の案内を出す', async () => {
    await seedQuery({ name: 'Only one', scope: globalScope })
    const wrapper = open(makeColumn(null))
    await flushPromises()

    await buttonByText(wrapper, 'ライブラリから追加').trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain(
      'ライブラリに追加可能なクエリがありません。',
    )
  })

  it('ストアタブは「このスコープに参加している個体があるか」で導入済みと導入ボタンを出し分ける', async () => {
    await seedQuery({
      name: 'No Federation (local copy)',
      scope: globalScope,
      storeId: 'no-federation',
    })
    stubRegistry([
      makeStoreEntry(),
      makeStoreEntry({ id: 'cw-only', name: 'CW Only', tags: ['cw'] }),
    ])

    const globalWrapper = open(makeColumn(null))
    await globalWrapper.find('[data-tab="store"]').trigger('click')
    await flushPromises()
    const installedCard = cardByName(globalWrapper, 'No Federation')
    expect(installedCard.props('alreadyInstalled')).toBe(true)
    expect(installedCard.text()).toContain('インストール済み')
    expect(
      buttonByText(
        cardByName(globalWrapper, 'CW Only'),
        'インストール',
      ).exists(),
    ).toBe(true)

    // 同じ本体でもアカウントのスコープには未参加なので、そちらでは導入ボタンが出る
    const aliceWrapper = open(makeColumn(alice.id))
    await aliceWrapper.find('[data-tab="store"]').trigger('click')
    await flushPromises()
    const notYet = cardByName(aliceWrapper, 'No Federation')
    expect(notYet.props('alreadyInstalled')).toBe(false)
    expect(buttonByText(notYet, 'インストール').exists()).toBe(true)
  })

  it('ストアタブの検索は名前・説明・タグで絞り込む', async () => {
    stubRegistry([
      makeStoreEntry(),
      makeStoreEntry({
        id: 'cw-only',
        name: 'CW Only',
        description: '閲覧注意だけ',
        tags: ['cw'],
      }),
    ])
    const wrapper = open(makeColumn(null))
    await wrapper.find('[data-tab="store"]').trigger('click')
    await flushPromises()
    expect(cardNames(wrapper)).toHaveLength(2)

    await setSearch(wrapper, 'cw')
    expect(cardNames(wrapper)).toEqual(['CW Only'])

    await setSearch(wrapper, '連合しない')
    expect(cardNames(wrapper)).toEqual(['No Federation'])

    await setSearch(wrapper, 'zzz')
    expect(cardNames(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('一致するクエリがありません')
  })

  it('ストアの feed が取れないときは「接続できません」と再試行を出し、再試行で取り直す', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = open(makeColumn(null))
    await wrapper.find('[data-tab="store"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('ストアに接続できません')
    expect(useMisStoreStore().queriesError).toBe('HTTP 503')

    stubRegistry([makeStoreEntry()])
    await buttonByText(wrapper, '再試行').trigger('click')
    await flushPromises()
    expect(cardNames(wrapper)).toEqual(['No Federation'])
  })

  it('セーフモードで起動しているとクエリが効いていない旨の案内を出す', async () => {
    readSafeModeMock.mockReturnValue(true)
    const wrapper = open(makeColumn(null))
    await flushPromises()
    expect(wrapper.text()).toContain(
      'セーフモードで起動中のためクエリは適用されていません。',
    )
  })

  it('通常起動ではセーフモードの案内を出さない', async () => {
    const wrapper = open(makeColumn(null))
    await flushPromises()
    expect(wrapper.text()).not.toContain('セーフモードで起動中')
  })
})

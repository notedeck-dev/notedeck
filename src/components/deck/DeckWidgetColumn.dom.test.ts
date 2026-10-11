// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, reactive, ref } from 'vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import type { ScopeTarget } from '@/services/distributable'
import {
  type Account,
  accountScopeKey,
  useAccountsStore,
} from '@/stores/accounts'
import type { ConfirmOptions } from '@/stores/confirm'
import type { DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { type StoreWidgetEntry, useMisStoreStore } from '@/stores/misstore'
import { useToast } from '@/stores/toast'
import { useWidgetsStore, type WidgetItem } from '@/stores/widgets'
import { useWindowsStore } from '@/stores/windows'
import { isWindowExposed } from '@/windows/exposure'
import DeckWidgetColumn from './DeckWidgetColumn.vue'

/**
 * ウィジェットカラムの UI ブロック (配置 / ライブラリピッカー / ストア) の
 * 振る舞いを固定する。配布物の管理カラム 5 種を 1 つにまとめる作業 (#1202)
 * の安全網。AiScript の実行系 (WidgetAiScript) は名前を出すだけのスタブ。
 *
 * 本体は紐付け配列で共有し、実行アカウントは配置 (`widgetRefs`) が持つ
 * (#1202 決定 (b) / (g))
 */

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

vi.mock('@/utils/url', () => ({
  openSafeUrl: vi.fn(),
}))

vi.mock('@/utils/haptics', () => ({
  hapticLight: vi.fn(),
  hapticSelection: vi.fn(),
  hapticMedium: vi.fn(),
}))

vi.mock('@/windows/exposure', () => ({
  isWindowExposed: vi.fn(() => true),
}))

const confirmMock = vi.fn(async (_opts: ConfirmOptions) => true)
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}))

/** アカウント選択は UI (パレット / シート) を開かず、テストが決めた id を返す */
const pickAccountMock = vi.fn(
  async (_purpose: string): Promise<string | null> => null,
)
vi.mock('@/composables/useAccountPicker', () => ({
  useAccountPicker: () => {
    const pickableAccounts = computed(() =>
      useAccountsStore().accounts.filter((a) => a.hasToken),
    )
    return {
      pickAccount: pickAccountMock,
      pickableAccounts,
      hasPickableAccount: computed(() => pickableAccounts.value.length > 0),
      sheetPurpose: ref<string | null>(null),
      resolveSheet: vi.fn(),
    }
  },
}))

/** 実行系は置き換え、受け取った widget 名と実行アカウントだけを DOM に出す */
vi.mock('@/components/deck/widgets/WidgetAiScript.vue', () => ({
  // defineAsyncComponent が `.default` を取り出す判定に __esModule を見る
  __esModule: true,
  default: defineComponent({
    name: 'WidgetAiScript',
    props: {
      widget: { type: Object, required: true },
      columnId: { type: String, required: true },
      accountId: { type: String, default: null },
      isSidebar: { type: Boolean, default: false },
    },
    emits: ['remove', 'drag-start'],
    template: `
      <div class="widget-stub" :data-install-id="widget.id" :data-account-id="accountId ?? ''">
        <span class="widget-stub-name">{{ widget.name }}</span>
        <button type="button" class="widget-stub-remove" @click="$emit('remove')">remove</button>
      </div>
    `,
  }),
}))
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})

const fetchMock = vi.fn()

function makeAccount(id: string, username: string): Account {
  return {
    id,
    host: 'misskey.test',
    userId: `uid-${id}`,
    username,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
  }
}

const accountA = makeAccount('acc-a', 'alice')
const accountB = makeAccount('acc-b', 'bob')
const keyA = accountScopeKey(accountA)
const keyB = accountScopeKey(accountB)

function makeWidget(
  installId: string,
  overrides: Partial<WidgetItem> = {},
): WidgetItem {
  return {
    id: installId,
    name: `Widget ${installId}`,
    content: `let x = 1 // ${installId}`,
    scope: { kind: 'shared', global: true, installedFor: [] },
    extra: { autoRun: false },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

/** 本体をライブラリに直接置く (ファイル経路を通らない) */
function seedWidget(...widgets: WidgetItem[]): void {
  const store = useWidgetsStore()
  store.ensureLoaded()
  store.items.push(...widgets)
}

function makeStoreEntry(
  id: string,
  overrides: Partial<StoreWidgetEntry> = {},
): StoreWidgetEntry {
  return {
    id,
    name: `Store ${id}`,
    version: '1.0.0',
    author: 'author',
    description: `description of ${id}`,
    icon: 'clock',
    autoRun: false,
    capabilities: [],
    tags: [],
    sourceUrl: `https://store.test/${id}.is`,
    apiUrl: `https://store.test/api/${id}`,
    sha512: `sha-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 空プロファイルを置いてから load する (既定デッキの seed を避ける) */
function seedEmptyDeck() {
  localStorage.setItem(
    'nd-deck-profiles',
    JSON.stringify([
      { id: 'p1', name: 'profile', columns: [], layout: [], createdAt: 1 },
    ]),
  )
  localStorage.setItem('nd-deck-active-profile', 'p1')
  useDeckStore().load()
}

let columnSeq = 0

/**
 * widget カラムをデッキに置く。プロファイルのカラムは shallowRef 配下の
 * 素のオブジェクトで、`attachWidget` 等の in-place な書換は props に届かない
 * (実機ではプロファイルの再読込で個体ごと差し替わる)。ここでは reactive な
 * 個体をプロファイルに差し込み、deckStore 経由の書換がそのまま描画へ
 * 反映されるようにする。
 */
function addWidgetColumn(
  partial: Partial<Omit<DeckColumn, 'id' | 'type'>> = {},
): DeckColumn {
  const profile = useDeckProfileStore()
  const column = reactive<DeckColumn>({
    id: `col-${++columnSeq}`,
    type: 'widget',
    name: null,
    width: 400,
    accountId: accountA.id,
    ...partial,
  })
  profile.setColumnsAndLayout(
    [...profile.columns, column],
    [...profile.layout, [column.id]],
  )
  return column
}

async function mountColumn(column: DeckColumn): Promise<VueWrapper> {
  const wrapper = mount(DeckWidgetColumn, {
    props: { column },
    attachTo: document.body,
    global: {
      stubs: {
        DeckColumn: {
          template:
            '<div class="deck-column-stub"><slot name="header-icon" /><slot name="header-meta" /><slot /></div>',
        },
        AccountPickerSheet: true,
        ColumnEmptyState: true,
      },
    },
  })
  // WidgetAiScript は defineAsyncComponent なので解決を待つ
  await flushPromises()
  return wrapper
}

function findButtonByText(wrapper: VueWrapper, text: string) {
  return wrapper
    .findAll('button')
    .find((b) => b.text().includes(text) || b.attributes('title') === text)
}

function placedNames(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.widget-stub-name').map((n) => n.text())
}

function placedAccountIds(wrapper: VueWrapper): [string, string][] {
  return wrapper
    .findAll('.widget-stub')
    .map((el) => [
      el.attributes('data-install-id') ?? '',
      el.attributes('data-account-id') ?? '',
    ])
}

/** ライブラリピッカーを開いて、そこに並ぶカード名を返す */
async function openPicker(wrapper: VueWrapper): Promise<string[]> {
  const btn = findButtonByText(wrapper, 'ウィジェットを追加')
  expect(btn).toBeTruthy()
  await btn?.trigger('click')
  return pickerCardNames(wrapper)
}

function pickerCardNames(wrapper: VueWrapper): string[] {
  return wrapper
    .findAllComponents({ name: 'WidgetCard' })
    .filter((c) => c.props('mode') === 'library')
    .map((c) => c.props('name') as string)
}

function pickerCard(wrapper: VueWrapper, name: string) {
  const card = wrapper
    .findAllComponents({ name: 'WidgetCard' })
    .find((c) => c.props('mode') === 'library' && c.props('name') === name)
  expect(card).toBeTruthy()
  // biome-ignore lint/style/noNonNullAssertion: 直前で存在を確認済み
  return card!
}

function storeCard(wrapper: VueWrapper, name: string) {
  const card = wrapper
    .findAllComponents({ name: 'WidgetCard' })
    .find((c) => c.props('mode') === 'store' && c.props('name') === name)
  expect(card).toBeTruthy()
  // biome-ignore lint/style/noNonNullAssertion: 直前で存在を確認済み
  return card!
}

async function switchToStoreTab(wrapper: VueWrapper) {
  const tab = wrapper
    .findAll('button.column-tab')
    .find((b) => b.text() === 'ストア')
  expect(tab).toBeTruthy()
  await tab?.trigger('click')
  await flushPromises()
}

let wrapper: VueWrapper | null = null

describe('DeckWidgetColumn', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.useFakeTimers()
    confirmMock.mockReset()
    confirmMock.mockResolvedValue(true)
    pickAccountMock.mockReset()
    pickAccountMock.mockResolvedValue(null)
    vi.mocked(isWindowExposed).mockReturnValue(true)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ widgets: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    // トーストは module-scope なので前のテストの残りを消す
    const toast = useToast()
    for (const t of [...toast.toasts.value]) toast.dismiss(t.id)

    const accounts = useAccountsStore()
    accounts.accounts = [accountA, accountB]
    accounts.isLoaded = true
    seedEmptyDeck()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('タブ', () => {
    it('「インストール済み」と「ストア」を切り替えると、ストア側は registry を 1 回取りに行き検索欄を出す', async () => {
      const column = addWidgetColumn()
      wrapper = await mountColumn(column)

      expect(wrapper.find('input[type="text"]').exists()).toBe(false)
      expect(findButtonByText(wrapper, 'ウィジェットを追加')).toBeTruthy()

      await switchToStoreTab(wrapper)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        '/registry/widgets.json',
      )
      const search = wrapper.find('input[type="text"]')
      expect(search.exists()).toBe(true)
      expect(search.attributes('placeholder')).toBe('ストアを探す')
      expect(findButtonByText(wrapper, 'ウィジェットを追加')).toBeUndefined()

      const installedTab = wrapper
        .findAll('button.column-tab')
        .find((b) => b.text().startsWith('インストール済み'))
      await installedTab?.trigger('click')
      expect(wrapper.find('input[type="text"]').exists()).toBe(false)
      expect(findButtonByText(wrapper, 'ウィジェットを追加')).toBeTruthy()
    })
  })

  describe('配置タブ', () => {
    it('column.widgetRefs に並ぶウィジェットだけを描画し、ピッカーには未配置のものだけを出す', async () => {
      seedWidget(
        makeWidget('w1', { name: 'Clock' }),
        makeWidget('w2', { name: 'Notes' }),
        makeWidget('w3', { name: 'Spare' }),
      )
      const column = addWidgetColumn({
        widgetRefs: [{ id: 'w2' }, { id: 'w1' }],
      })
      wrapper = await mountColumn(column)

      expect(placedNames(wrapper)).toEqual(['Notes', 'Clock'])
      expect(
        wrapper
          .findAll('button.column-tab')
          .find((b) => b.text().startsWith('インストール済み'))
          ?.text(),
      ).toBe('インストール済み 2')

      expect(await openPicker(wrapper)).toEqual(['Spare'])

      // 配置すると描画に加わり、ピッカーは閉じる。本体はこのカラムのアカウントに紐付く
      await pickerCard(wrapper, 'Spare').vm.$emit('place')
      await flushPromises()
      expect(column.widgetRefs).toEqual([
        { id: 'w2' },
        { id: 'w1' },
        { id: 'w3' },
      ])
      expect(placedNames(wrapper)).toEqual(['Notes', 'Clock', 'Spare'])
      expect(pickerCardNames(wrapper)).toEqual([])
      expect(useWidgetsStore().get('w3')?.scope).toMatchObject({
        installedFor: [keyA],
      })
    })

    it('ピッカーに配置候補が無ければ空メッセージを出す', async () => {
      seedWidget(makeWidget('w1'))
      const column = addWidgetColumn({ widgetRefs: [{ id: 'w1' }] })
      wrapper = await mountColumn(column)

      expect(await openPicker(wrapper)).toEqual([])
      expect(wrapper.text()).toContain(
        'ライブラリに配置可能なウィジェットがありません。',
      )
    })

    it('全アカウントのカラムでは配置の実行アカウントで動かし、未指定の配置はアカウント無し (null) で渡す', async () => {
      seedWidget(makeWidget('w-shared'), makeWidget('w-free'))
      const column = addWidgetColumn({
        accountId: null,
        widgetRefs: [
          { id: 'w-shared', accountKey: keyB },
          { id: 'w-shared', accountKey: keyA },
          { id: 'w-free' },
        ],
      })
      wrapper = await mountColumn(column)

      // 同じ本体を alice 用と bob 用に 2 つ置ける (#1202 決定 (g))
      expect(placedAccountIds(wrapper)).toEqual([
        ['w-shared', accountB.id],
        ['w-shared', accountA.id],
        ['w-free', ''],
      ])
    })

    it('アカウント指定のカラムでは、実行アカウント未指定の配置はカラムのアカウントで動かす', async () => {
      seedWidget(makeWidget('w-free'))
      const column = addWidgetColumn({ widgetRefs: [{ id: 'w-free' }] })
      wrapper = await mountColumn(column)

      expect(placedAccountIds(wrapper)).toEqual([['w-free', accountA.id]])
    })

    it('全アカウントのカラムでライブラリから配置すると、アカウントを選ばせてその実行アカウントで配置し、本体をそのアカウントに紐付ける', async () => {
      seedWidget(
        makeWidget('w-free', {
          name: 'Free',
          scope: { kind: 'shared', global: false, installedFor: [] },
        }),
      )
      const column = addWidgetColumn({ accountId: null, widgetRefs: [] })
      wrapper = await mountColumn(column)
      pickAccountMock.mockResolvedValue(accountB.id)

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Free').vm.$emit('place')
      await flushPromises()

      expect(pickAccountMock).toHaveBeenCalledWith(
        '「Free」をどのアカウントで動かしますか？',
      )
      expect(column.widgetRefs).toEqual([{ id: 'w-free', accountKey: keyB }])
      expect(useWidgetsStore().get('w-free')?.scope).toMatchObject({
        installedFor: [keyB],
      })
      expect(placedAccountIds(wrapper)).toEqual([['w-free', accountB.id]])
    })

    it('全アカウントのカラムで編集を開くときはアカウントを選ばせ、本体には何も書かない', async () => {
      seedWidget(makeWidget('w-free', { name: 'Free' }))
      const column = addWidgetColumn({ accountId: null, widgetRefs: [] })
      wrapper = await mountColumn(column)
      const windows = useWindowsStore()
      const openSpy = vi.spyOn(windows, 'open').mockReturnValue('win-1')
      pickAccountMock.mockResolvedValue(accountB.id)

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Free').vm.$emit('edit')
      await flushPromises()

      expect(pickAccountMock).toHaveBeenCalledWith(
        '「Free」をどのアカウントで動かしますか？',
      )
      expect(useWidgetsStore().get('w-free')?.scope).toMatchObject({
        global: true,
        installedFor: [],
      })
      expect(openSpy).toHaveBeenCalledWith('widget-edit', {
        widgetId: 'w-free',
        accountId: accountB.id,
      })
    })

    it('全アカウントのカラムでアカウント選択をキャンセルすると、配置も編集ウィンドウも起きない', async () => {
      seedWidget(makeWidget('w-free', { name: 'Free' }))
      const column = addWidgetColumn({ accountId: null, widgetRefs: [] })
      wrapper = await mountColumn(column)
      const openSpy = vi.spyOn(useWindowsStore(), 'open')
      pickAccountMock.mockResolvedValue(null)

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Free').vm.$emit('edit')
      await pickerCard(wrapper, 'Free').vm.$emit('place')
      await flushPromises()

      expect(column.widgetRefs).toEqual([])
      expect(openSpy).not.toHaveBeenCalled()
    })

    it('全アカウントのカラムのピッカーは配置済みの本体も出す (別のアカウントで置き直せる)', async () => {
      seedWidget(makeWidget('w1', { name: 'Clock' }))
      const column = addWidgetColumn({
        accountId: null,
        widgetRefs: [{ id: 'w1', accountKey: keyA }],
      })
      wrapper = await mountColumn(column)
      expect(await openPicker(wrapper)).toEqual(['Clock'])
    })
  })

  describe('配置から外す', () => {
    it('ウィジェットを外すと配置だけ消えてライブラリには残り、トーストの「元に戻す」で同じ位置に戻る', async () => {
      seedWidget(
        makeWidget('w1', { name: 'Clock' }),
        makeWidget('w2', { name: 'Notes' }),
      )
      const column = addWidgetColumn({
        widgetRefs: [{ id: 'w1' }, { id: 'w2' }],
      })
      wrapper = await mountColumn(column)

      await wrapper
        .find('[data-install-id="w1"] .widget-stub-remove')
        .trigger('click')
      await flushPromises()

      expect(column.widgetRefs).toEqual([{ id: 'w2' }])
      expect(placedNames(wrapper)).toEqual(['Notes'])
      expect(useWidgetsStore().get('w1')).toBeTruthy()

      const toast = useToast().toasts.value.at(-1)
      expect(toast?.text).toBe('ウィジェットを外しました')
      expect(toast?.action?.label).toBe('元に戻す')

      toast?.action?.onClick()
      await flushPromises()
      expect(column.widgetRefs).toEqual([{ id: 'w1' }, { id: 'w2' }])
      expect(placedNames(wrapper)).toEqual(['Clock', 'Notes'])
    })
  })

  describe('ライブラリから削除', () => {
    it('削除は確認を挟み、OK なら本体を消してトーストの「元に戻す」で復元する', async () => {
      seedWidget(
        makeWidget('w1', { name: 'Clock' }),
        makeWidget('w2', { name: 'Notes' }),
      )
      const column = addWidgetColumn({ widgetRefs: [{ id: 'w1' }] })
      wrapper = await mountColumn(column)
      const widgets = useWidgetsStore()

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Notes').vm.$emit('delete')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledTimes(1)
      expect(confirmMock.mock.calls[0]?.[0]).toMatchObject({
        title: 'ウィジェットを削除',
        message:
          '「Notes」をライブラリから削除しますか？ウィジェットのコードも消えます。',
        type: 'danger',
      })
      expect(widgets.get('w2')).toBeUndefined()
      expect(pickerCardNames(wrapper)).toEqual([])

      const toast = useToast().toasts.value.at(-1)
      expect(toast?.text).toBe('ウィジェットを削除しました')
      toast?.action?.onClick()
      await flushPromises()
      expect(widgets.get('w2')?.name).toBe('Notes')
      expect(pickerCardNames(wrapper)).toEqual(['Notes'])
    })

    it('確認でキャンセルすると何も消えない', async () => {
      seedWidget(makeWidget('w2', { name: 'Notes' }))
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)
      confirmMock.mockResolvedValue(false)

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Notes').vm.$emit('delete')
      await flushPromises()

      expect(useWidgetsStore().get('w2')).toBeTruthy()
      expect(pickerCardNames(wrapper)).toEqual(['Notes'])
      expect(useToast().toasts.value).toHaveLength(0)
    })

    it('他のカラムに配置中のウィジェットを削除すると、そのカラムの配置も剥がす', async () => {
      seedWidget(makeWidget('w-shared', { name: 'Shared' }))
      const other = addWidgetColumn({ widgetRefs: [{ id: 'w-shared' }] })
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Shared').vm.$emit('delete')
      await flushPromises()

      expect(useDeckStore().getColumn(other.id)?.widgetRefs).toEqual([])
      expect(useWidgetsStore().get('w-shared')).toBeUndefined()
    })
  })

  describe('新規作成', () => {
    it('ヘッダーの + でライブラリに空のウィジェットをこのカラムのアカウントに紐付けて足し、編集ウィンドウを開く (カラムには配置しない)', async () => {
      const widgets = useWidgetsStore()
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)
      const openSpy = vi.spyOn(useWindowsStore(), 'open').mockReturnValue('w')

      const plus = findButtonByText(wrapper, '新規ローカルウィジェットを作成')
      expect(plus).toBeTruthy()
      await plus?.trigger('click')
      await flushPromises()

      expect(widgets.items).toHaveLength(1)
      const created = widgets.items[0]
      expect(created?.content).toBe('')
      expect(created?.name).toBe(`Widget ${created?.id.slice(4, 12)}`)
      expect(created?.scope).toEqual({
        kind: 'shared',
        global: false,
        installedFor: [keyA],
      })
      expect(openSpy).toHaveBeenCalledWith('widget-edit', {
        widgetId: created?.id,
        accountId: accountA.id,
      })
      expect(column.widgetRefs).toEqual([])
      expect(pickAccountMock).not.toHaveBeenCalled()
    })

    it('全アカウントのカラムでは先にアカウントを選ばせ、全体スコープで作ってそのアカウントで編集ウィンドウを開く', async () => {
      const widgets = useWidgetsStore()
      const column = addWidgetColumn({ accountId: null, widgetRefs: [] })
      wrapper = await mountColumn(column)
      const openSpy = vi.spyOn(useWindowsStore(), 'open').mockReturnValue('w')
      pickAccountMock.mockResolvedValue(accountB.id)

      await findButtonByText(
        wrapper,
        '新規ローカルウィジェットを作成',
      )?.trigger('click')
      await flushPromises()

      expect(pickAccountMock).toHaveBeenCalledWith(
        'ウィジェットをどのアカウントで動かしますか？',
      )
      expect(widgets.items[0]?.scope).toMatchObject({ global: true })
      expect(openSpy).toHaveBeenCalledWith('widget-edit', {
        widgetId: widgets.items[0]?.id,
        accountId: accountB.id,
      })
    })

    it('widget-edit ウィンドウが露出していなければ + ボタンを出さない', async () => {
      vi.mocked(isWindowExposed).mockReturnValue(false)
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)

      expect(
        findButtonByText(wrapper, '新規ローカルウィジェットを作成'),
      ).toBeUndefined()
    })
  })

  describe('読取専用 (ソース欠損)', () => {
    it('ピッカーのカードに「ソース欠損」バッジを出し、store 側の変更は拒否される', async () => {
      seedWidget(
        makeWidget('w-ro', { name: 'Broken', content: '', readOnly: true }),
      )
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)
      const widgets = useWidgetsStore()

      // 拒否時の console.warn は想定内なので黙らせる
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      await openPicker(wrapper)
      const card = pickerCard(wrapper, 'Broken')
      expect(card.props('readOnly')).toBe(true)
      expect(card.text()).toContain('ソース欠損')
      expect(card.props('description')).toBe('空のコード')

      expect(await widgets.update('w-ro', { content: 'let y = 2' })).toBe(false)
      expect(await widgets.update('w-ro', { name: 'Renamed' })).toBe(false)
      expect(widgets.get('w-ro')?.name).toBe('Broken')
      expect(warn).toHaveBeenCalledTimes(2)
      warn.mockRestore()
    })
  })

  describe('ストアタブ', () => {
    it('インストール済みの判定は本体の紐付けで決まり、済みなら「インストール済み」、未なら「インストール」を出す', async () => {
      seedWidget(
        // アカウント不要: 本体があれば済み
        makeWidget('clock-inst', { store: { id: 'clock' } }),
        // アカウント必須: 別アカウント (B) にだけ紐付く本体 → カラム A では未
        makeWidget('notes-b', {
          store: { id: 'notes' },
          scope: { kind: 'shared', global: false, installedFor: [keyB] },
        }),
      )
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          widgets: [
            makeStoreEntry('clock', { name: 'Clock' }),
            makeStoreEntry('notes', {
              name: 'Notes',
              capabilities: ['misskey-api'],
            }),
          ],
        }),
      })
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)

      await switchToStoreTab(wrapper)

      const clock = storeCard(wrapper, 'Clock')
      expect(clock.props('alreadyInstalled')).toBe(true)
      expect(
        clock.findAll('button').some((b) => b.text() === 'インストール済み'),
      ).toBe(true)

      const notes = storeCard(wrapper, 'Notes')
      expect(notes.props('alreadyInstalled')).toBe(false)
      expect(notes.props('capabilityOk')).toBe(true)
      expect(
        notes.findAll('button').some((b) => b.text() === 'インストール'),
      ).toBe(true)
    })

    it('インストールすると misstore 経由でこのカラムのスコープに本体を作り、配置して「インストール済み」タブへ戻る', async () => {
      const widgets = useWidgetsStore()
      const misStore = useMisStoreStore()
      const entry = makeStoreEntry('clock', { name: 'Clock' })
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ widgets: [entry] }),
      })
      const installSpy = vi
        .spyOn(misStore, 'installWidget')
        .mockImplementation(async (e, scope?: ScopeTarget) => {
          const w = makeWidget(e.id, {
            name: e.name,
            store: { id: e.id },
            scope: {
              kind: 'shared',
              global: scope?.kind === 'global',
              installedFor: scope?.kind === 'account' ? [scope.key] : [],
            },
          })
          widgets.items.push(w)
          return w
        })
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)

      await switchToStoreTab(wrapper)
      await storeCard(wrapper, 'Clock').vm.$emit('install')
      await flushPromises()

      expect(installSpy).toHaveBeenCalledWith(entry, {
        kind: 'account',
        key: keyA,
      })
      expect(column.widgetRefs).toEqual([{ id: 'clock' }])
      expect(placedNames(wrapper)).toEqual(['Clock'])
      expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    })

    it('同じ storeId の本体が既にあれば新しく作らず、紐付けを足して配置だけする', async () => {
      const misStore = useMisStoreStore()
      seedWidget(
        makeWidget('clock-inst', {
          name: 'Clock (local)',
          store: { id: 'clock' },
          scope: { kind: 'shared', global: false, installedFor: [keyB] },
        }),
      )
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ widgets: [makeStoreEntry('clock')] }),
      })
      const installSpy = vi.spyOn(misStore, 'installWidget')
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)

      await switchToStoreTab(wrapper)
      await storeCard(wrapper, 'Store clock').vm.$emit('install')
      await flushPromises()

      expect(installSpy).not.toHaveBeenCalled()
      expect(column.widgetRefs).toEqual([{ id: 'clock-inst' }])
      const widgets = useWidgetsStore()
      expect(widgets.items).toHaveLength(1)
      expect(widgets.get('clock-inst')?.scope).toMatchObject({
        installedFor: [keyB, keyA],
      })
    })

    it('全アカウントのカラムでアカウント必須のアイテムを入れると、選んだアカウントで配置する', async () => {
      const widgets = useWidgetsStore()
      const misStore = useMisStoreStore()
      const entry = makeStoreEntry('notes', {
        name: 'Notes',
        capabilities: ['misskey-api'],
      })
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ widgets: [entry] }),
      })
      vi.spyOn(misStore, 'installWidget').mockImplementation(async (e) => {
        const w = makeWidget(e.id, { name: e.name, store: { id: e.id } })
        widgets.items.push(w)
        return w
      })
      pickAccountMock.mockResolvedValue(accountB.id)
      const column = addWidgetColumn({ accountId: null, widgetRefs: [] })
      wrapper = await mountColumn(column)

      await switchToStoreTab(wrapper)
      await storeCard(wrapper, 'Notes').vm.$emit('install')
      await flushPromises()

      expect(misStore.installWidget).toHaveBeenCalledWith(entry, {
        kind: 'account',
        key: keyB,
      })
      expect(column.widgetRefs).toEqual([{ id: 'notes', accountKey: keyB }])
      expect(placedAccountIds(wrapper)).toEqual([['notes', accountB.id]])
    })

    it('検索語で名前・説明・作者・タグを絞り込み、一致しなければ空メッセージを出す', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          widgets: [
            makeStoreEntry('clock', { name: 'Clock', tags: ['time'] }),
            makeStoreEntry('notes', { name: 'Notes', author: 'zed' }),
          ],
        }),
      })
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)
      await switchToStoreTab(wrapper)

      const search = wrapper.find('input[type="text"]')
      await search.setValue('TIME')
      expect(
        wrapper
          .findAllComponents({ name: 'WidgetCard' })
          .map((c) => c.props('name')),
      ).toEqual(['Clock'])

      await search.setValue('zed')
      expect(
        wrapper
          .findAllComponents({ name: 'WidgetCard' })
          .map((c) => c.props('name')),
      ).toEqual(['Notes'])

      await search.setValue('nothing')
      expect(wrapper.findAllComponents({ name: 'WidgetCard' })).toHaveLength(0)
      expect(wrapper.text()).toContain('一致するウィジェットがありません')
    })

    it('registry の取得に失敗したら「ストアを利用できません」と再試行ボタンを出す', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 })
      const column = addWidgetColumn({ widgetRefs: [] })
      wrapper = await mountColumn(column)
      await switchToStoreTab(wrapper)

      expect(useMisStoreStore().widgetsError).toBe('HTTP 503')
      expect(wrapper.findAllComponents({ name: 'WidgetCard' })).toHaveLength(0)
      const retry = findButtonByText(wrapper, '再試行')
      expect(retry).toBeTruthy()

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ widgets: [makeStoreEntry('clock')] }),
      })
      await retry?.trigger('click')
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(wrapper.findAllComponents({ name: 'WidgetCard' })).toHaveLength(1)
    })
  })

  describe('サイドバー', () => {
    it('sidebar カラムは column.widgetRefs ではなく sidebarPlacements を配置として使う', async () => {
      const widgets = useWidgetsStore()
      seedWidget(
        makeWidget('w-side', { name: 'Side' }),
        makeWidget('w-col', { name: 'Col' }),
        makeWidget('w-spare', { name: 'Spare' }),
      )
      widgets.addToSidebar({ id: 'w-side' })
      const column = addWidgetColumn({
        sidebar: true,
        widgetRefs: [{ id: 'w-col' }],
      })
      wrapper = await mountColumn(column)

      expect(placedNames(wrapper)).toEqual(['Side'])
      // ピッカーの「未配置」も sidebar 並びを基準にする
      expect(await openPicker(wrapper)).toEqual(['Col', 'Spare'])

      await pickerCard(wrapper, 'Spare').vm.$emit('place')
      await flushPromises()
      expect(widgets.sidebarPlacements).toEqual([
        { id: 'w-side' },
        { id: 'w-spare' },
      ])
      expect(column.widgetRefs).toEqual([{ id: 'w-col' }])
      expect(placedNames(wrapper)).toEqual(['Side', 'Spare'])
    })

    it('sidebar カラムで外すと sidebarPlacements から消え、「元に戻す」で戻る', async () => {
      const widgets = useWidgetsStore()
      seedWidget(
        makeWidget('w-a', { name: 'A' }),
        makeWidget('w-b', { name: 'B' }),
      )
      widgets.addToSidebar({ id: 'w-a' })
      widgets.addToSidebar({ id: 'w-b' })
      const column = addWidgetColumn({ sidebar: true })
      wrapper = await mountColumn(column)

      await wrapper
        .find('[data-install-id="w-a"] .widget-stub-remove')
        .trigger('click')
      await flushPromises()
      expect(widgets.sidebarPlacements).toEqual([{ id: 'w-b' }])
      expect(widgets.get('w-a')).toBeTruthy()

      useToast().toasts.value.at(-1)?.action?.onClick()
      await flushPromises()
      expect(widgets.sidebarPlacements).toEqual([{ id: 'w-a' }, { id: 'w-b' }])
      expect(placedNames(wrapper)).toEqual(['A', 'B'])
    })
  })
})

describe('DeckWidgetColumn — 共通基盤 (#1098 §4)', () => {
  it('useColumnSetup をこのカラムで setup する', async () => {
    vi.mocked(useColumnSetup).mockClear()
    const wrapper = await mountColumn({
      id: 'col-base',
      type: 'widget',
      name: null,
      width: 300,
      accountId: null,
    } as DeckColumn)
    expect(vi.mocked(useColumnSetup).mock.calls.at(-1)?.[0]()).toMatchObject({
      type: 'widget',
    })
    wrapper.unmount()
  })
})

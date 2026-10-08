// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, reactive, ref } from 'vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
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
import { useWidgetsStore, type WidgetMeta } from '@/stores/widgets'
import { useWindowsStore } from '@/stores/windows'
import { isWindowExposed } from '@/windows/exposure'
import DeckWidgetColumn from './DeckWidgetColumn.vue'

/**
 * ウィジェットカラムの UI ブロック (配置 / ライブラリピッカー / ストア) の
 * 振る舞いを固定する。配布物の管理カラム 5 種を 1 つにまとめる作業 (#1202)
 * の安全網。AiScript の実行系 (WidgetAiScript) は名前を出すだけのスタブ。
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
      <div class="widget-stub" :data-install-id="widget.installId" :data-account-id="accountId ?? ''">
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

function makeWidget(
  installId: string,
  overrides: Partial<WidgetMeta> = {},
): WidgetMeta {
  return {
    installId,
    name: `Widget ${installId}`,
    src: `let x = 1 // ${installId}`,
    autoRun: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
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

function placedAccountIds(wrapper: VueWrapper): Record<string, string> {
  const out: Record<string, string> = {}
  for (const el of wrapper.findAll('.widget-stub')) {
    out[el.attributes('data-install-id') ?? ''] =
      el.attributes('data-account-id') ?? ''
  }
  return out
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
    it('column.widgetIds に並ぶウィジェットだけを描画し、ピッカーには未配置のものだけを出す', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w1', { name: 'Clock' }))
      widgets.addWidget(makeWidget('w2', { name: 'Notes' }))
      widgets.addWidget(makeWidget('w3', { name: 'Spare' }))
      const column = addWidgetColumn({ widgetIds: ['w2', 'w1'] })
      wrapper = await mountColumn(column)

      expect(placedNames(wrapper)).toEqual(['Notes', 'Clock'])
      expect(
        wrapper
          .findAll('button.column-tab')
          .find((b) => b.text().startsWith('インストール済み'))
          ?.text(),
      ).toBe('インストール済み 2')

      expect(await openPicker(wrapper)).toEqual(['Spare'])

      // 配置すると描画に加わり、ピッカーは閉じる
      await pickerCard(wrapper, 'Spare').vm.$emit('place')
      await flushPromises()
      expect(column.widgetIds).toEqual(['w2', 'w1', 'w3'])
      expect(placedNames(wrapper)).toEqual(['Notes', 'Clock', 'Spare'])
      expect(pickerCardNames(wrapper)).toEqual([])
    })

    it('ピッカーに配置候補が無ければ空メッセージを出す', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w1'))
      const column = addWidgetColumn({ widgetIds: ['w1'] })
      wrapper = await mountColumn(column)

      expect(await openPicker(wrapper)).toEqual([])
      expect(wrapper.text()).toContain(
        'ライブラリに配置可能なウィジェットがありません。',
      )
    })

    it('全アカウントのカラムでは、ウィジェットに固定したアカウントで動かし、未固定のものはアカウント無し (null) で渡す', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(
        makeWidget('w-fixed', { accountKey: accountScopeKey(accountB) }),
      )
      widgets.addWidget(makeWidget('w-free'))
      const column = addWidgetColumn({
        accountId: null,
        widgetIds: ['w-fixed', 'w-free'],
      })
      wrapper = await mountColumn(column)

      expect(placedAccountIds(wrapper)).toEqual({
        'w-fixed': accountB.id,
        'w-free': '',
      })
    })

    it('アカウント指定のカラムでは、未固定のウィジェットはカラムのアカウントで動かす', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w-free'))
      const column = addWidgetColumn({ widgetIds: ['w-free'] })
      wrapper = await mountColumn(column)

      expect(placedAccountIds(wrapper)).toEqual({ 'w-free': accountA.id })
    })

    it('全アカウントのカラムで未固定のウィジェットを編集すると、アカウントを選ばせてそのウィジェットに固定してから編集ウィンドウを開く', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w-free', { name: 'Free' }))
      const column = addWidgetColumn({ accountId: null, widgetIds: [] })
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
      expect(widgets.getWidget('w-free')?.accountKey).toBe(
        accountScopeKey(accountB),
      )
      expect(openSpy).toHaveBeenCalledWith('widget-edit', {
        widgetId: 'w-free',
        accountId: accountB.id,
      })
    })

    it('全アカウントのカラムでアカウント選択をキャンセルすると、固定も編集ウィンドウも起きない', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w-free', { name: 'Free' }))
      const column = addWidgetColumn({ accountId: null, widgetIds: [] })
      wrapper = await mountColumn(column)
      const openSpy = vi.spyOn(useWindowsStore(), 'open')
      pickAccountMock.mockResolvedValue(null)

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Free').vm.$emit('edit')
      await flushPromises()

      expect(widgets.getWidget('w-free')?.accountKey).toBeUndefined()
      expect(openSpy).not.toHaveBeenCalled()
    })

    it('ピッカーのカードには固定した実行アカウントのラベルを出し、未固定には出さない', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(
        makeWidget('w-fixed', {
          name: 'Fixed',
          accountKey: accountScopeKey(accountB),
        }),
      )
      widgets.addWidget(makeWidget('w-free', { name: 'Free' }))
      const column = addWidgetColumn({ accountId: null, widgetIds: [] })
      wrapper = await mountColumn(column)

      await openPicker(wrapper)
      expect(pickerCard(wrapper, 'Fixed').props('accountLabel')).toBe(
        '@bob@misskey.test',
      )
      expect(pickerCard(wrapper, 'Free').props('accountLabel')).toBeUndefined()
    })
  })

  describe('配置から外す', () => {
    it('ウィジェットを外すと配置だけ消えてライブラリには残り、トーストの「元に戻す」で同じ位置に戻る', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w1', { name: 'Clock' }))
      widgets.addWidget(makeWidget('w2', { name: 'Notes' }))
      const column = addWidgetColumn({ widgetIds: ['w1', 'w2'] })
      wrapper = await mountColumn(column)

      await wrapper
        .find('[data-install-id="w1"] .widget-stub-remove')
        .trigger('click')
      await flushPromises()

      expect(column.widgetIds).toEqual(['w2'])
      expect(placedNames(wrapper)).toEqual(['Notes'])
      expect(widgets.getWidget('w1')).toBeTruthy()

      const toast = useToast().toasts.value.at(-1)
      expect(toast?.text).toBe('ウィジェットを外しました')
      expect(toast?.action?.label).toBe('元に戻す')

      toast?.action?.onClick()
      await flushPromises()
      expect(column.widgetIds).toEqual(['w1', 'w2'])
      expect(placedNames(wrapper)).toEqual(['Clock', 'Notes'])
    })
  })

  describe('ライブラリから削除', () => {
    it('削除は確認を挟み、OK なら本体を消してトーストの「元に戻す」で復元する', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w1', { name: 'Clock' }))
      widgets.addWidget(makeWidget('w2', { name: 'Notes' }))
      const column = addWidgetColumn({ widgetIds: ['w1'] })
      wrapper = await mountColumn(column)

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
      expect(widgets.getWidget('w2')).toBeUndefined()
      expect(pickerCardNames(wrapper)).toEqual([])

      const toast = useToast().toasts.value.at(-1)
      expect(toast?.text).toBe('ウィジェットを削除しました')
      toast?.action?.onClick()
      await flushPromises()
      expect(widgets.getWidget('w2')?.name).toBe('Notes')
      expect(pickerCardNames(wrapper)).toEqual(['Notes'])
    })

    it('確認でキャンセルすると何も消えない', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w2', { name: 'Notes' }))
      const column = addWidgetColumn({ widgetIds: [] })
      wrapper = await mountColumn(column)
      confirmMock.mockResolvedValue(false)

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Notes').vm.$emit('delete')
      await flushPromises()

      expect(widgets.getWidget('w2')).toBeTruthy()
      expect(pickerCardNames(wrapper)).toEqual(['Notes'])
      expect(useToast().toasts.value).toHaveLength(0)
    })

    it('他のカラムに配置中のウィジェットを削除すると、そのカラムの参照も剥がす', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w-shared', { name: 'Shared' }))
      const other = addWidgetColumn({ widgetIds: ['w-shared'] })
      const column = addWidgetColumn({ widgetIds: [] })
      wrapper = await mountColumn(column)

      await openPicker(wrapper)
      await pickerCard(wrapper, 'Shared').vm.$emit('delete')
      await flushPromises()

      expect(useDeckStore().getColumn(other.id)?.widgetIds).toEqual([])
      expect(widgets.getWidget('w-shared')).toBeUndefined()
    })
  })

  describe('新規作成', () => {
    it('ヘッダーの + でライブラリに空のウィジェットを足して編集ウィンドウを開く (カラムには配置しない)', async () => {
      const widgets = useWidgetsStore()
      const column = addWidgetColumn({ widgetIds: [] })
      wrapper = await mountColumn(column)
      const openSpy = vi.spyOn(useWindowsStore(), 'open').mockReturnValue('w')

      const plus = findButtonByText(wrapper, '新規ローカルウィジェットを作成')
      expect(plus).toBeTruthy()
      await plus?.trigger('click')
      await flushPromises()

      expect(widgets.widgets).toHaveLength(1)
      const created = widgets.widgets[0]
      expect(created?.src).toBe('')
      expect(created?.accountKey).toBeUndefined()
      expect(openSpy).toHaveBeenCalledWith('widget-edit', {
        widgetId: created?.installId,
        accountId: accountA.id,
      })
      expect(column.widgetIds).toEqual([])
      expect(pickAccountMock).not.toHaveBeenCalled()
    })

    it('全アカウントのカラムでは先にアカウントを選ばせ、新規ウィジェットをそのアカウントに固定する', async () => {
      const widgets = useWidgetsStore()
      const column = addWidgetColumn({ accountId: null, widgetIds: [] })
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
      expect(widgets.widgets[0]?.accountKey).toBe(accountScopeKey(accountB))
      expect(openSpy).toHaveBeenCalledWith('widget-edit', {
        widgetId: widgets.widgets[0]?.installId,
        accountId: accountB.id,
      })
    })

    it('widget-edit ウィンドウが露出していなければ + ボタンを出さない', async () => {
      vi.mocked(isWindowExposed).mockReturnValue(false)
      const column = addWidgetColumn({ widgetIds: [] })
      wrapper = await mountColumn(column)

      expect(
        findButtonByText(wrapper, '新規ローカルウィジェットを作成'),
      ).toBeUndefined()
    })
  })

  describe('読取専用 (ソース欠損)', () => {
    it('ピッカーのカードに「ソース欠損」バッジを出し、store 側の変更は拒否される', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(
        makeWidget('w-ro', { name: 'Broken', src: '', readOnly: true }),
      )
      const column = addWidgetColumn({ widgetIds: [] })
      wrapper = await mountColumn(column)

      // 拒否時の console.warn は想定内なので黙らせる
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      await openPicker(wrapper)
      const card = pickerCard(wrapper, 'Broken')
      expect(card.props('readOnly')).toBe(true)
      expect(card.text()).toContain('ソース欠損')
      expect(card.props('description')).toBe('空のコード')

      expect(widgets.updateSrc('w-ro', 'let y = 2')).toBe(false)
      expect(widgets.renameWidget('w-ro', 'Renamed')).toBe(false)
      expect(widgets.getWidget('w-ro')?.name).toBe('Broken')
      expect(warn).toHaveBeenCalledTimes(2)
      warn.mockRestore()
    })
  })

  describe('ストアタブ', () => {
    it('インストール済みの判定は storeId × 実行アカウントで決まり、済みなら「インストール済み」、未なら「インストール」を出す', async () => {
      const widgets = useWidgetsStore()
      // アカウント不要: 個体が 1 つでもあれば済み
      widgets.addWidget(makeWidget('clock-inst', { storeId: 'clock' }))
      // アカウント必須: 別アカウント (B) に固定した個体だけ → カラム A では未
      widgets.addWidget(
        makeWidget('notes-b', {
          storeId: 'notes',
          accountKey: accountScopeKey(accountB),
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
      const column = addWidgetColumn({ widgetIds: [] })
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

    it('インストールすると misstore 経由で個体を作り、このカラムに配置して「インストール済み」タブへ戻る', async () => {
      const widgets = useWidgetsStore()
      const misStore = useMisStoreStore()
      const entry = makeStoreEntry('clock', { name: 'Clock' })
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ widgets: [entry] }),
      })
      const installSpy = vi
        .spyOn(misStore, 'installWidget')
        .mockImplementation(async (e, accountKey) => {
          const w = makeWidget(e.id, {
            name: e.name,
            storeId: e.id,
            ...(accountKey ? { accountKey } : {}),
          })
          widgets.addWidget(w)
          return w
        })
      const column = addWidgetColumn({ widgetIds: [] })
      wrapper = await mountColumn(column)

      await switchToStoreTab(wrapper)
      await storeCard(wrapper, 'Clock').vm.$emit('install')
      await flushPromises()

      expect(installSpy).toHaveBeenCalledWith(entry, undefined)
      expect(column.widgetIds).toEqual(['clock'])
      expect(placedNames(wrapper)).toEqual(['Clock'])
      expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    })

    it('同じ storeId × アカウントの個体が既にあれば新しく作らず配置だけする', async () => {
      const widgets = useWidgetsStore()
      const misStore = useMisStoreStore()
      widgets.addWidget(
        makeWidget('clock-inst', { name: 'Clock (local)', storeId: 'clock' }),
      )
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ widgets: [makeStoreEntry('clock')] }),
      })
      const installSpy = vi.spyOn(misStore, 'installWidget')
      const column = addWidgetColumn({ widgetIds: [] })
      wrapper = await mountColumn(column)

      await switchToStoreTab(wrapper)
      // カードは「インストール済み」だが install イベント自体は配置に落ちる
      await storeCard(wrapper, 'Store clock').vm.$emit('install')
      await flushPromises()

      expect(installSpy).not.toHaveBeenCalled()
      expect(column.widgetIds).toEqual(['clock-inst'])
      expect(widgets.widgets).toHaveLength(1)
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
      const column = addWidgetColumn({ widgetIds: [] })
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
      const column = addWidgetColumn({ widgetIds: [] })
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
    it('sidebar カラムは column.widgetIds ではなく sidebarWidgetIds を配置として使う', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w-side', { name: 'Side' }))
      widgets.addWidget(makeWidget('w-col', { name: 'Col' }))
      widgets.addWidget(makeWidget('w-spare', { name: 'Spare' }))
      widgets.addToSidebar('w-side')
      const column = addWidgetColumn({ sidebar: true, widgetIds: ['w-col'] })
      wrapper = await mountColumn(column)

      expect(placedNames(wrapper)).toEqual(['Side'])
      // ピッカーの「未配置」も sidebar 並びを基準にする
      expect(await openPicker(wrapper)).toEqual(['Col', 'Spare'])

      await pickerCard(wrapper, 'Spare').vm.$emit('place')
      await flushPromises()
      expect(widgets.sidebarWidgetIds).toEqual(['w-side', 'w-spare'])
      expect(column.widgetIds).toEqual(['w-col'])
      expect(placedNames(wrapper)).toEqual(['Side', 'Spare'])
    })

    it('sidebar カラムで外すと sidebarWidgetIds から消え、「元に戻す」で戻る', async () => {
      const widgets = useWidgetsStore()
      widgets.addWidget(makeWidget('w-a', { name: 'A' }))
      widgets.addWidget(makeWidget('w-b', { name: 'B' }))
      widgets.addToSidebar('w-a')
      widgets.addToSidebar('w-b')
      const column = addWidgetColumn({ sidebar: true })
      wrapper = await mountColumn(column)

      await wrapper
        .find('[data-install-id="w-a"] .widget-stub-remove')
        .trigger('click')
      await flushPromises()
      expect(widgets.sidebarWidgetIds).toEqual(['w-b'])
      expect(widgets.getWidget('w-a')).toBeTruthy()

      useToast().toasts.value.at(-1)?.action?.onClick()
      await flushPromises()
      expect(widgets.sidebarWidgetIds).toEqual(['w-a', 'w-b'])
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

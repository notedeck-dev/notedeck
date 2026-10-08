// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import type { StoreSkillEntry } from '@/stores/misstore'
import { type SkillMeta, useSkillsStore } from '@/stores/skills'
import { useWindowsStore } from '@/stores/windows'
import ColumnSection from './ColumnSection.vue'
import DeckSkillColumn from './DeckSkillColumn.vue'

/**
 * スキル管理カラムの UI ブロックの振る舞い (#1202 の統合前の安全網)。
 * ストアはブラウザモード (isTauri=false) で動くので add() で直接 seed する。
 */

const h = vi.hoisted(() => ({
  confirm: vi.fn(async (_opts: Record<string, unknown>) => true),
  toastShow: vi.fn(),
  isWindowExposed: vi.fn((_type: string) => true),
  openSafeUrl: vi.fn(async () => undefined),
}))

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: h.confirm }),
}))
vi.mock('@/stores/toast', () => ({
  useToast: () => ({ show: h.toastShow }),
}))
vi.mock('@/windows/exposure', () => ({
  isWindowExposed: h.isWindowExposed,
}))
vi.mock('@/utils/url', () => ({
  openSafeUrl: h.openSafeUrl,
}))
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})

const column: DeckColumnType = {
  id: 'col-skill',
  type: 'skill',
  name: null,
  width: 320,
  accountId: null,
} as DeckColumnType

function makeSkill(
  partial: Partial<SkillMeta> & Pick<SkillMeta, 'id'>,
): Omit<SkillMeta, 'createdAt' | 'updatedAt'> {
  return {
    name: partial.id,
    version: '1.0.0',
    description: '',
    mode: 'manual',
    triggers: [],
    body: 'body',
    cheapCheckCapabilities: [],
    ...partial,
  }
}

function storeEntry(
  partial: Partial<StoreSkillEntry> & Pick<StoreSkillEntry, 'id'>,
): StoreSkillEntry {
  return {
    name: partial.id,
    version: '1.0.0',
    author: 'author',
    description: 'store desc',
    category: 'utility',
    tags: [],
    sourceUrl: `https://store.notedeck.io/src/${partial.id}.md`,
    apiUrl: '',
    sha512: 'sha-registry',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function mountColumn() {
  return mount(DeckSkillColumn, {
    props: { column },
    global: {
      stubs: {
        DeckColumn: {
          template: '<div><slot name="header-meta" /><slot /></div>',
        },
      },
    },
  })
}

type Wrapper = VueWrapper<InstanceType<typeof DeckSkillColumn>>

/** 一覧の行 (カード)。名前の要素から外側へ `card` クラスまで辿る */
function cardOf(wrapper: Wrapper, displayName: string): HTMLElement {
  const nameEl = wrapper
    .findAll('button, span')
    .find((w) => w.text() === displayName)
  if (!nameEl) throw new Error(`card not found: ${displayName}`)
  const card = nameEl.element.closest('[class*="card"]')
  if (!(card instanceof HTMLElement)) throw new Error('card ancestor missing')
  return card
}

function buttonsOf(el: HTMLElement): HTMLButtonElement[] {
  return Array.from(el.querySelectorAll('button'))
}

function buttonByTitle(
  el: HTMLElement,
  title: string,
): HTMLButtonElement | undefined {
  return buttonsOf(el).find((b) => b.title === title)
}

function tabButton(wrapper: Wrapper, title: string) {
  const btn = wrapper
    .findAll('button.column-tab')
    .find((b) => b.attributes('title') === title)
  if (!btn) throw new Error(`tab not found: ${title}`)
  return btn
}

function searchInput(wrapper: Wrapper) {
  return wrapper.find('input[type="text"]')
}

const okJson = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => data }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  h.confirm.mockReset()
  h.confirm.mockResolvedValue(true)
  h.toastShow.mockReset()
  h.isWindowExposed.mockReset()
  h.isWindowExposed.mockReturnValue(true)
  h.openSafeUrl.mockReset()
  fetchMock = vi.fn(async () => okJson({ skills: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeckSkillColumn — タブ', () => {
  it('インストール済みタブが初期表示で、ストアタブに切り替えるとレジストリを取得してストアの検索欄に変わる', async () => {
    const wrapper = mountColumn()
    await nextTick()
    expect(searchInput(wrapper).attributes('placeholder')).toBe('スキルを探す')
    expect(fetchMock).not.toHaveBeenCalled()

    await tabButton(wrapper, 'ストア').trigger('click')
    await flushPromises()

    expect(searchInput(wrapper).attributes('placeholder')).toBe('ストアを探す')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/registry/skills.json',
    )

    await tabButton(wrapper, 'インストール済み 0').trigger('click')
    await nextTick()
    expect(searchInput(wrapper).attributes('placeholder')).toBe('スキルを探す')
  })

  it('インストール済みタブのラベルにスキル数を出す', async () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'a' }))
    store.add(makeSkill({ id: 'b' }))
    const wrapper = mountColumn()
    await nextTick()
    expect(() => tabButton(wrapper, 'インストール済み 2')).not.toThrow()
  })
})

describe('DeckSkillColumn — 一覧の検索と分類', () => {
  it('検索語を入れると名前か説明に一致するスキルだけに絞られる', async () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'alpha', name: 'Alpha' }))
    store.add(
      makeSkill({ id: 'beta', name: 'Beta', description: 'alpha を補助' }),
    )
    store.add(makeSkill({ id: 'gamma', name: 'Gamma' }))
    const wrapper = mountColumn()
    await nextTick()
    expect(wrapper.text()).toContain('Gamma')

    await searchInput(wrapper).setValue('ALPHA')
    await nextTick()

    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('Beta')
    expect(wrapper.text()).not.toContain('Gamma')

    await searchInput(wrapper).setValue('zzz')
    await nextTick()
    expect(wrapper.text()).toContain('一致するスキルがありません')
  })

  it('storeId の無いスキルは「サイドロード」、ある物は「ストア配布」のセクションに出る', async () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'mine', name: 'Mine' }))
    store.add(makeSkill({ id: 'aizu', name: 'Aizu', storeId: 'aizu' }))
    const wrapper = mountColumn()
    await nextTick()

    const sections = wrapper.findAllComponents(ColumnSection)
    expect(sections.map((s) => s.props('label'))).toEqual([
      'サイドロード',
      'ストア配布',
    ])
    expect(sections[0]?.text()).toContain('Mine')
    expect(sections[0]?.text()).not.toContain('Aizu')
    expect(sections[1]?.text()).toContain('Aizu')
    expect(sections[1]?.text()).not.toContain('Mine')
  })

  it('0 件のセクションは表示しない', async () => {
    useSkillsStore().add(makeSkill({ id: 'mine', name: 'Mine' }))
    const wrapper = mountColumn()
    await nextTick()
    const sections = wrapper.findAllComponents(ColumnSection)
    expect(sections.map((s) => s.props('label'))).toEqual(['サイドロード'])
  })

  it('スキルが 1 つも無いと空表示を出す', async () => {
    const wrapper = mountColumn()
    await nextTick()
    expect(wrapper.text()).toContain('スキルがインストールされていません')
  })
})

describe('DeckSkillColumn — 予約スキル (AGENTS / HEARTBEAT)', () => {
  it('予約スキルは配布物ではないのでスキルカラムに出さず、件数にも数えない (入口は AI 設定)', async () => {
    const store = useSkillsStore()
    store.add(
      makeSkill({
        id: 'AGENTS',
        name: 'AGENTS',
        fileBase: 'AGENTS',
        mode: 'always',
        reserved: true,
      }),
    )
    store.add(
      makeSkill({
        id: 'HEARTBEAT',
        name: 'HEARTBEAT',
        fileBase: 'HEARTBEAT',
        mode: 'heartbeat',
        reserved: true,
      }),
    )
    store.add(makeSkill({ id: 'plain', name: 'Plain' }))
    const wrapper = mountColumn()
    await nextTick()

    expect(wrapper.text()).not.toContain('ルール')
    expect(wrapper.text()).not.toContain('巡回')
    expect(wrapper.text()).toContain('Plain')
    const sections = wrapper.findAllComponents({ name: 'ColumnSection' })
    expect(sections.map((s) => s.props('count'))).toEqual([1])
    expect(wrapper.text()).toContain('インストール済み 1')
  })
})

describe('DeckSkillColumn — 有効化と HEARTBEAT', () => {
  it('「有効にする」を押すと store の active が立ち、ボタンが「無効にする」に変わる', async () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'plain', name: 'Plain' }))
    const wrapper = mountColumn()
    await nextTick()

    const card = cardOf(wrapper, 'Plain')
    expect(card.textContent).toContain('無効')
    const enable = buttonsOf(card).find(
      (b) => b.textContent?.trim() === '有効にする',
    )
    expect(enable).toBeDefined()
    enable?.click()
    await nextTick()

    expect(store.isActive('plain')).toBe(true)
    const disable = buttonsOf(cardOf(wrapper, 'Plain')).find(
      (b) => b.textContent?.trim() === '無効にする',
    )
    expect(disable).toBeDefined()
    disable?.click()
    await nextTick()
    expect(store.isActive('plain')).toBe(false)
  })

  it('HEARTBEAT ボタンを押すと mode が heartbeat になり、もう一度押すと manual に戻る', async () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'plain', name: 'Plain' }))
    const wrapper = mountColumn()
    await nextTick()

    buttonByTitle(cardOf(wrapper, 'Plain'), 'HEARTBEAT で定期実行する')?.click()
    await nextTick()
    expect(store.get('plain')?.mode).toBe('heartbeat')
    expect(cardOf(wrapper, 'Plain').textContent).toContain('HEARTBEAT')

    buttonByTitle(cardOf(wrapper, 'Plain'), 'HEARTBEAT 対象から外す')?.click()
    await nextTick()
    expect(store.get('plain')?.mode).toBe('manual')
  })

  it('mode=always のスキルは active 印が無くても有効扱いで、トグルは押せない', async () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'rule', name: 'Rule', mode: 'always' }))
    const wrapper = mountColumn()
    await nextTick()

    const card = cardOf(wrapper, 'Rule')
    expect(store.isActive('rule')).toBe(false)
    expect(card.textContent).toContain('常時')
    expect(card.textContent).not.toContain('無効\n')
    expect(card.querySelector('[class*="disabledBadge"]')).toBeNull()
    const toggle = buttonsOf(card).find(
      (b) => b.textContent?.trim() === '無効にする',
    )
    expect(toggle?.disabled).toBe(true)
    expect(toggle?.title).toBe('常時有効のスキルです')
    toggle?.click()
    await nextTick()
    expect(store.isActive('rule')).toBe(false)
  })
})

describe('DeckSkillColumn — 削除', () => {
  it('削除ボタン → 確認 OK で一覧から消え、「元に戻す」付きトーストから復元できる', async () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'plain', name: 'Plain' }))
    const wrapper = mountColumn()
    await nextTick()

    buttonByTitle(
      cardOf(wrapper, 'Plain'),
      'ライブラリから削除 (本文も消えます)',
    )?.click()
    await flushPromises()

    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.confirm.mock.calls[0]?.[0]).toMatchObject({
      title: 'スキルを削除',
      type: 'danger',
    })
    expect(store.skills.map((s) => s.id)).toEqual([])
    expect(wrapper.text()).not.toContain('Plain')

    expect(h.toastShow).toHaveBeenCalledTimes(1)
    const [text, type, options] = h.toastShow.mock.calls[0] as [
      string,
      string,
      { action?: { label: string; onClick: () => void } },
    ]
    expect(text).toBe('スキルを削除しました')
    expect(type).toBe('info')
    expect(options.action?.label).toBe('元に戻す')

    options.action?.onClick()
    await nextTick()
    expect(store.skills.map((s) => s.id)).toEqual(['plain'])
    expect(wrapper.text()).toContain('Plain')
  })

  it('確認でキャンセルすると削除もトーストも起きない', async () => {
    h.confirm.mockResolvedValue(false)
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'plain', name: 'Plain' }))
    const wrapper = mountColumn()
    await nextTick()

    buttonByTitle(
      cardOf(wrapper, 'Plain'),
      'ライブラリから削除 (本文も消えます)',
    )?.click()
    await flushPromises()

    expect(store.skills.map((s) => s.id)).toEqual(['plain'])
    expect(h.toastShow).not.toHaveBeenCalled()
  })
})

describe('DeckSkillColumn — 作成と編集 (開発者モード #1034)', () => {
  it('skill-edit が露出していれば「+」で新規スキルを足して編集ウィンドウを開く', async () => {
    const store = useSkillsStore()
    const windows = useWindowsStore()
    const open = vi.spyOn(windows, 'open')
    const wrapper = mountColumn()
    await nextTick()

    const plus = wrapper
      .findAll('button')
      .find((b) => b.attributes('title') === '新規スキルを作成')
    expect(plus).toBeDefined()
    await plus?.trigger('click')
    await nextTick()

    expect(store.skills).toHaveLength(1)
    const created = store.skills[0]
    expect(created?.name).toBe('新規スキル')
    expect(created?.mode).toBe('manual')
    expect(open).toHaveBeenCalledWith('skill-edit', { skillId: created?.id })
    expect(wrapper.text()).toContain('新規スキル')
  })

  it('skill-edit が露出していなければ「+」も編集ボタンも出ず、行を押しても開かない', async () => {
    h.isWindowExposed.mockReturnValue(false)
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'plain', name: 'Plain' }))
    const windows = useWindowsStore()
    const open = vi.spyOn(windows, 'open')
    const wrapper = mountColumn()
    await nextTick()

    expect(
      wrapper
        .findAll('button')
        .find((b) => b.attributes('title') === '新規スキルを作成'),
    ).toBeUndefined()
    const card = cardOf(wrapper, 'Plain')
    expect(buttonByTitle(card, '編集')).toBeUndefined()
    // 名前は button ではなく静的な span
    expect(card.querySelector('button[class*="name"]')).toBeNull()
    card.click()
    await nextTick()
    expect(open).not.toHaveBeenCalled()
    expect(store.skills).toHaveLength(1)
  })

  it('編集ボタンと名前はそのスキルの id を skill-edit ウィンドウに渡す', async () => {
    const store = useSkillsStore()
    store.add(makeSkill({ id: 'alpha', name: 'Alpha' }))
    store.add(makeSkill({ id: 'beta', name: 'Beta' }))
    const windows = useWindowsStore()
    const open = vi.spyOn(windows, 'open')
    const wrapper = mountColumn()
    await nextTick()

    buttonByTitle(cardOf(wrapper, 'Beta'), '編集')?.click()
    await nextTick()
    expect(open).toHaveBeenLastCalledWith('skill-edit', { skillId: 'beta' })

    const nameBtn = buttonsOf(cardOf(wrapper, 'Alpha')).find(
      (b) => b.textContent?.trim() === 'Alpha',
    )
    nameBtn?.click()
    await nextTick()
    expect(open).toHaveBeenLastCalledWith('skill-edit', { skillId: 'alpha' })
    expect(open).toHaveBeenCalledTimes(2)
  })
})

describe('DeckSkillColumn — ストアタブ', () => {
  it('storeId が一致する項目は「インストール済み」、それ以外は「インストール」ボタンになる', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        skills: [
          storeEntry({ id: 'aizu', name: 'Aizu' }),
          storeEntry({ id: 'fresh', name: 'Fresh' }),
        ],
      }),
    )
    const store = useSkillsStore()
    store.add(
      makeSkill({ id: 'aizu-local', name: 'Aizu (local)', storeId: 'aizu' }),
    )
    const wrapper = mountColumn()
    await nextTick()

    await tabButton(wrapper, 'ストア').trigger('click')
    await flushPromises()

    const aizu = cardOf(wrapper, 'Aizu')
    expect(aizu.querySelector('.ti-circle-check-filled')).not.toBeNull()
    const installedBtn = buttonsOf(aizu).find(
      (b) => b.textContent?.trim() === 'インストール済み',
    )
    expect(installedBtn?.disabled).toBe(true)
    expect(
      buttonsOf(aizu).find((b) => b.textContent?.trim() === 'インストール'),
    ).toBeUndefined()

    const fresh = cardOf(wrapper, 'Fresh')
    expect(fresh.querySelector('.ti-circle-check-filled')).toBeNull()
    const installBtn = buttonsOf(fresh).find(
      (b) => b.textContent?.trim() === 'インストール',
    )
    expect(installBtn?.disabled).toBe(false)
  })

  it('ストアの検索欄は名前・説明・作者・タグで絞る', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        skills: [
          storeEntry({ id: 'aizu', name: 'Aizu', tags: ['persona'] }),
          storeEntry({ id: 'fresh', name: 'Fresh', author: 'someone' }),
        ],
      }),
    )
    const wrapper = mountColumn()
    await nextTick()
    await tabButton(wrapper, 'ストア').trigger('click')
    await flushPromises()

    await searchInput(wrapper).setValue('persona')
    await nextTick()
    expect(wrapper.text()).toContain('Aizu')
    expect(wrapper.text()).not.toContain('Fresh')

    await searchInput(wrapper).setValue('someone')
    await nextTick()
    expect(wrapper.text()).toContain('Fresh')
    expect(wrapper.text()).not.toContain('Aizu')
  })

  it('レジストリ取得に失敗すると「ストアに接続できません」と再試行を出す', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response)
    const wrapper = mountColumn()
    await nextTick()
    await tabButton(wrapper, 'ストア').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('ストアに接続できません')
    const retry = wrapper.findAll('button').find((b) => b.text() === '再試行')
    expect(retry).toBeDefined()
    fetchMock.mockResolvedValue(
      okJson({ skills: [storeEntry({ id: 'fresh', name: 'Fresh' })] }),
    )
    await retry?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Fresh')
  })

  it('外部リンクボタンで MisStore の詳細ページを開く', async () => {
    fetchMock.mockResolvedValue(
      okJson({ skills: [storeEntry({ id: 'fresh', name: 'Fresh' })] }),
    )
    const wrapper = mountColumn()
    await nextTick()
    await tabButton(wrapper, 'ストア').trigger('click')
    await flushPromises()

    buttonByTitle(cardOf(wrapper, 'Fresh'), 'MisStore で詳細を開く')?.click()
    await nextTick()
    expect(h.openSafeUrl).toHaveBeenCalledWith(
      'https://store.notedeck.io/skills/fresh',
    )
  })
})

describe('DeckSkillColumn — 共通基盤 (#1098 §4)', () => {
  it('useColumnSetup をこのカラムで setup する', async () => {
    vi.mocked(useColumnSetup).mockClear()
    const wrapper = await mountColumn()
    expect(vi.mocked(useColumnSetup).mock.calls.at(-1)?.[0]()).toMatchObject({
      type: 'skill',
    })
    wrapper.unmount()
  })
})

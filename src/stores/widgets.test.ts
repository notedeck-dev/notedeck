// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { pushSnapshot } from '@/utils/historyFs'
import { STORAGE_KEYS, setStorageJson } from '@/utils/storage'
import { useWidgetsStore, type WidgetItem } from './widgets'

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function makeWidget(id: string, partial: Partial<WidgetItem> = {}): WidgetItem {
  return {
    id,
    name: id,
    content: `src of ${id}`,
    scope: { kind: 'shared', global: true, installedFor: [] },
    extra: { autoRun: false },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

function newWidget(id: string, partial: Partial<WidgetItem> = {}) {
  const { createdAt: _c, updatedAt: _u, ...input } = makeWidget(id, partial)
  return input
}

/** ロード前の localStorage ミラーに個体を仕込む (移行はロード直後に 1 回だけ走る) */
function seed(...widgets: WidgetItem[]) {
  setStorageJson(STORAGE_KEYS.widgets, widgets)
}

describe('useWidgetsStore — 再実行シグナル (#744)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('未マウントなら requestRerun は発火せず 0 を返す', () => {
    const store = useWidgetsStore()
    expect(store.requestRerun('w1')).toBe(0)
    expect(store.rerunSignal('w1')).toBe(0)
  })

  it('マウント中はインスタンス数を返しシグナルが進む', () => {
    const store = useWidgetsStore()
    store.registerMounted('w1')
    store.registerMounted('w1')

    expect(store.requestRerun('w1')).toBe(2)
    expect(store.rerunSignal('w1')).toBe(1)
    expect(store.requestRerun('w1')).toBe(2)
    expect(store.rerunSignal('w1')).toBe(2)
    // 別 widget には影響しない
    expect(store.rerunSignal('w2')).toBe(0)
  })

  it('unregisterMounted で 0 に戻ったら発火しない', () => {
    const store = useWidgetsStore()
    store.registerMounted('w1')
    store.unregisterMounted('w1')
    expect(store.requestRerun('w1')).toBe(0)
    expect(store.rerunSignal('w1')).toBe(0)
  })

  it('自分の編集 (エディタの自動保存) では再実行しない (#744)', async () => {
    const store = useWidgetsStore()
    await store.add(newWidget('w1'))
    store.registerMounted('w1')
    await store.update('w1', { content: 'edited' })
    expect(store.rerunSignal('w1')).toBe(0)
  })
})

describe('useWidgetsStore.remove (undo)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('undo が widget を元の位置に復元する', async () => {
    const store = useWidgetsStore()
    await store.add(newWidget('w1'))
    await store.add(newWidget('w2'))
    await store.add(newWidget('w3'))
    const undo = await store.remove('w2')
    expect(store.get('w2')).toBeUndefined()
    expect(undo).toBeTypeOf('function')
    undo?.()
    expect(store.items.map((w) => w.id)).toEqual(['w1', 'w2', 'w3'])
    expect(store.get('w2')?.content).toBe('src of w2')
  })

  it('存在しない id は undefined を返す', async () => {
    const store = useWidgetsStore()
    expect(await store.remove('nope')).toBeUndefined()
  })

  it('undo が sidebar の配置と位置を復元する', async () => {
    const store = useWidgetsStore()
    await store.add(newWidget('w1'))
    await store.add(newWidget('w2'))
    store.addToSidebar({ id: 'w1', accountKey: 'h:u' })
    store.addToSidebar({ id: 'w2' })
    const undo = await store.remove('w1')
    expect(store.sidebarPlacements).toEqual([{ id: 'w2' }])
    undo?.()
    expect(store.sidebarPlacements).toEqual([
      { id: 'w1', accountKey: 'h:u' },
      { id: 'w2' },
    ])
  })

  it('undo が AiScript ストレージ (Mk:save 領域、全名前空間) を復元する', async () => {
    const store = useWidgetsStore()
    await store.add(newWidget('w1'))
    localStorage.setItem('nd-aiscript-app-w1:key', '"v"')
    localStorage.setItem('nd-aiscript-app-w1/h:u:key', '"vu"')
    const undo = await store.remove('w1')
    expect(localStorage.getItem('nd-aiscript-app-w1:key')).toBeNull()
    expect(localStorage.getItem('nd-aiscript-app-w1/h:u:key')).toBeNull()
    undo?.()
    expect(localStorage.getItem('nd-aiscript-app-w1:key')).toBe('"v"')
    expect(localStorage.getItem('nd-aiscript-app-w1/h:u:key')).toBe('"vu"')
  })
})

describe('applyStoreUpdate (#913 ストア再インストール)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('本文とストア由来メタを上書きし name / autoRun / 紐付けは維持する', async () => {
    const store = useWidgetsStore()
    await store.add(
      newWidget('w1', {
        name: 'My Renamed',
        extra: { autoRun: true },
        store: { id: 'ent-widget' },
        iconUrl: 'https://example.com/old.svg',
        scope: { kind: 'shared', global: false, installedFor: ['h:u'] },
      }),
    )
    await store.applyStoreUpdate('w1', {
      content: 'new src',
      iconUrl: 'https://example.com/new.svg',
      store: { id: 'ent-widget', sha512: 'abc', version: '2.0.0' },
    })
    expect(store.get('w1')).toMatchObject({
      content: 'new src',
      iconUrl: 'https://example.com/new.svg',
      store: { id: 'ent-widget', sha512: 'abc', version: '2.0.0' },
      // ローカル値は維持
      name: 'My Renamed',
      extra: { autoRun: true },
      scope: { global: false, installedFor: ['h:u'] },
    })
  })

  it('ソース欠損の readOnly 個体は検証済み配布ソースで復旧する', async () => {
    const store = useWidgetsStore()
    await store.add(newWidget('w1', { content: '' }))
    store.items = [{ ...(store.get('w1') as WidgetItem), readOnly: true }]
    await store.applyStoreUpdate('w1', {
      content: 'recovered',
      store: { id: 'ent', sha512: 'abc', version: '1.0.0' },
    })
    expect(store.get('w1')?.content).toBe('recovered')
    expect(store.get('w1')?.readOnly).toBeFalsy()
  })

  it('未知の installId には false を返す', async () => {
    const store = useWidgetsStore()
    expect(
      await store.applyStoreUpdate('nope', {
        content: 's',
        store: { id: 'ent', sha512: 'a', version: '1' },
      }),
    ).toBe(false)
  })
})

describe('編集履歴の同値ガード (#981)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.mocked(pushSnapshot).mockClear()
  })

  async function addWidget(id: string) {
    const store = useWidgetsStore()
    await store.add(newWidget(id, { name: 'hist', content: '<: "v1"' }))
    const live = store.get(id)
    if (live) live.fileBase = 'hist'
  }

  it('内容が変わる保存は編集前 snapshot (src / name / autoRun) を積む', async () => {
    await addWidget('w-hist-changed')
    await useWidgetsStore().update('w-hist-changed', { content: '<: "v2"' })
    expect(pushSnapshot).toHaveBeenCalledTimes(1)
    expect(pushSnapshot).toHaveBeenCalledWith(
      'widget',
      'hist',
      { src: '<: "v1"', name: 'hist', autoRun: false },
      undefined,
    )
  })

  it('同じ内容の保存では積まない (自動保存でリングを使い潰さない)', async () => {
    await addWidget('w-hist-same')
    await useWidgetsStore().update('w-hist-same', { content: '<: "v1"' })
    expect(pushSnapshot).not.toHaveBeenCalled()
  })
})

const yami = {
  id: 'uuid-yami',
  host: 'yami.ski',
  userId: 'u1',
  username: 'alice',
  hasToken: true,
} as Account

function setupAccounts() {
  const accounts = useAccountsStore()
  accounts.accounts = [yami]
  accounts.isLoaded = true
}

describe('初回読込の移行 (#1202 段階 1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('createdAt 昇順に並べる', () => {
    seed(
      makeWidget('late', { createdAt: 20 }),
      makeWidget('early', { createdAt: 10 }),
    )
    const store = useWidgetsStore()
    store.ensureLoaded()
    expect(store.items.map((w) => w.id)).toEqual(['early', 'late'])
  })

  it('同じ storeId の複製は最古を本体に統合し、紐付けを束ね、配置の書き換えを積む (決定 (i))', async () => {
    localStorage.setItem('nd-aiscript-app-copy:count', '7')
    localStorage.setItem('nd-aiscript-app-body:count', '1')
    setStorageJson(STORAGE_KEYS.widgetsSidebarOrder, ['copy', 'body'])
    seed(
      makeWidget('copy', {
        createdAt: 5,
        content: 'diverged',
        store: { id: 'clock' },
        scope: { kind: 'shared', global: false, installedFor: ['h:v'] },
        extra: { autoRun: false, legacyAccountKey: 'h:v' },
      }),
      makeWidget('body', {
        createdAt: 2,
        content: 'base',
        store: { id: 'clock' },
        scope: { kind: 'shared', global: false, installedFor: ['h:u'] },
        extra: { autoRun: false, legacyAccountKey: 'h:u' },
        fileBase: 'clock',
      }),
    )
    const store = useWidgetsStore()
    store.ensureLoaded()
    await flush()

    expect(store.items.map((w) => w.id)).toEqual(['body'])
    expect(store.get('body')?.scope).toEqual({
      kind: 'shared',
      global: false,
      installedFor: ['h:u', 'h:v'],
    })
    // 分岐した本文は本体の履歴へ
    expect(pushSnapshot).toHaveBeenCalledWith('widget', 'clock', {
      src: 'diverged',
      name: 'copy',
      autoRun: false,
    })
    // Mk:save は本体の名前空間 (実行アカウント別) へ。本体の旧状態も自分の名前空間へ
    expect(localStorage.getItem('nd-aiscript-app-body/h:v:count')).toBe('7')
    expect(localStorage.getItem('nd-aiscript-app-copy:count')).toBeNull()
    expect(localStorage.getItem('nd-aiscript-app-body/h:u:count')).toBe('1')
    expect(localStorage.getItem('nd-aiscript-app-body:count')).toBeNull()
    // 配置は本体 id + 実行アカウントへ (サイドバーは自分で、カラムは deck が取り出す)
    expect(store.sidebarPlacements).toEqual([
      { id: 'body', accountKey: 'h:v' },
      { id: 'body', accountKey: 'h:u' },
    ])
    expect(store.takePlacementRewrites()).toEqual([
      { from: 'copy', to: { id: 'body', accountKey: 'h:v' } },
      { from: 'body', to: { id: 'body', accountKey: 'h:u' } },
    ])
    expect(store.pendingPlacementRewrites).toEqual([])
    // 固定の印は消える
    expect(store.get('body')?.extra.legacyAccountKey).toBeUndefined()
  })

  it('旧 accountId (UUID) は accounts ロード後に安定キーの紐付けへ写す。該当しなければ全体スコープ', async () => {
    setupAccounts()
    seed(
      makeWidget('w1', {
        scope: { kind: 'shared', global: false, installedFor: [] },
        extra: { autoRun: false, legacyAccountId: 'uuid-yami' },
      }),
      makeWidget('w2', {
        scope: { kind: 'shared', global: false, installedFor: [] },
        extra: { autoRun: false, legacyAccountId: 'uuid-dead' },
      }),
    )
    const store = useWidgetsStore()
    store.ensureLoaded()
    await flush()

    expect(store.get('w1')?.scope).toMatchObject({
      installedFor: ['yami.ski:u1'],
    })
    expect(store.get('w1')?.extra.legacyAccountId).toBeUndefined()
    expect(store.get('w2')?.scope).toMatchObject({ global: true })
    expect(store.get('w2')?.extra.legacyAccountId).toBeUndefined()
  })

  it('accounts 未ロードなら旧 accountId の移行は待つ', async () => {
    seed(
      makeWidget('w1', {
        extra: { autoRun: false, legacyAccountId: 'uuid-yami' },
      }),
    )
    const store = useWidgetsStore()
    store.ensureLoaded()
    await flush()
    expect(store.get('w1')?.extra.legacyAccountId).toBe('uuid-yami')
  })

  it('サイドバーの旧形式 (installId の配列) は配置として読み、不在の本体を外す', () => {
    setStorageJson(STORAGE_KEYS.widgetsSidebarOrder, ['w1', 'gone'])
    seed(makeWidget('w1'))
    const store = useWidgetsStore()
    store.ensureLoaded()
    expect(store.sidebarPlacements).toEqual([{ id: 'w1' }])
  })
})

describe('useWidgetsStore.purgeAccount — アカウント削除で紐付けを外す (#1061 / #1114)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('同じ安定キーの紐付けだけを外し、本体はライブラリに残す', async () => {
    const store = useWidgetsStore()
    await store.add(
      newWidget('w1', {
        scope: {
          kind: 'shared',
          global: false,
          installedFor: ['yami.ski:u1', 'h:x'],
        },
      }),
    )
    await store.add(
      newWidget('w2', {
        scope: {
          kind: 'shared',
          global: false,
          installedFor: ['cloud.example:u2'],
        },
      }),
    )
    await store.purgeAccount('yami.ski:u1')
    expect(store.items.map((w) => w.id)).toEqual(['w1', 'w2'])
    expect(store.get('w1')?.scope).toMatchObject({ installedFor: ['h:x'] })
    expect(store.get('w2')?.scope).toMatchObject({
      installedFor: ['cloud.example:u2'],
    })
  })
})

describe('読取専用 (ソース欠損) のウィジェットは変更を拒否する (#1111)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('自動実行・改名・ソース・紐付けの変更を拒否して false を返す', async () => {
    const store = useWidgetsStore()
    await store.add(newWidget('ro', { content: '' }))
    const live = store.get('ro')
    if (live) live.readOnly = true
    expect(await store.setAutoRun('ro', true)).toBe(false)
    expect(store.get('ro')?.extra.autoRun).toBe(false)
    expect(await store.update('ro', { name: 'renamed' })).toBe(false)
    expect(store.get('ro')?.name).toBe('ro')
    expect(await store.update('ro', { content: 'x' })).toBe(false)
    expect(await store.link('ro', { kind: 'account', key: 'h:u' })).toBe(false)
  })

  it('通常のウィジェットでは true を返す', async () => {
    const store = useWidgetsStore()
    await store.add(newWidget('ok'))
    expect(await store.setAutoRun('ok', true)).toBe(true)
    expect(store.get('ok')?.extra.autoRun).toBe(true)
    expect(await store.update('ok', { name: 'renamed' })).toBe(true)
  })
})

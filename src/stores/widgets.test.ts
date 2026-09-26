// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { pushSnapshot } from '@/utils/historyFs'
import { STORAGE_KEYS, setStorageJson } from '@/utils/storage'
import { useWidgetsStore, type WidgetMeta } from './widgets'

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

describe('useWidgetsStore — 再実行シグナル (#744)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
})

function makeWidget(installId: string, name = installId): WidgetMeta {
  return {
    installId,
    name,
    src: `src of ${installId}`,
    autoRun: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('useWidgetsStore.removeWidget (undo)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('undo が widget を元の位置に復元する', () => {
    const store = useWidgetsStore()
    store.addWidget(makeWidget('w1'))
    store.addWidget(makeWidget('w2'))
    store.addWidget(makeWidget('w3'))
    const undo = store.removeWidget('w2')
    expect(store.getWidget('w2')).toBeUndefined()
    expect(undo).toBeTypeOf('function')
    undo?.()
    expect(store.widgets.map((w) => w.installId)).toEqual(['w1', 'w2', 'w3'])
    expect(store.getWidget('w2')?.src).toBe('src of w2')
  })

  it('存在しない id は undefined を返す', () => {
    const store = useWidgetsStore()
    expect(store.removeWidget('nope')).toBeUndefined()
  })

  it('undo が sidebar 並び位置を復元する', () => {
    const store = useWidgetsStore()
    store.addWidget(makeWidget('w1'))
    store.addWidget(makeWidget('w2'))
    store.addToSidebar('w1')
    store.addToSidebar('w2')
    const undo = store.removeWidget('w1')
    expect(store.sidebarWidgetIds).toEqual(['w2'])
    undo?.()
    expect(store.sidebarWidgetIds).toEqual(['w1', 'w2'])
  })

  it('undo が AiScript ストレージ (Mk:save 領域) を復元する', () => {
    const store = useWidgetsStore()
    store.addWidget(makeWidget('w1'))
    localStorage.setItem('nd-aiscript-app-w1:key', '"v"')
    const undo = store.removeWidget('w1')
    expect(localStorage.getItem('nd-aiscript-app-w1:key')).toBeNull()
    undo?.()
    expect(localStorage.getItem('nd-aiscript-app-w1:key')).toBe('"v"')
  })
})

describe('applyStoreUpdate (#913 ストア再インストール)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('src とストア由来メタを上書きし name / autoRun は維持する', () => {
    const store = useWidgetsStore()
    store.addWidget({
      ...makeWidget('w1', 'My Renamed'),
      autoRun: true,
      storeId: 'ent-widget',
      iconUrl: 'https://example.com/old.svg',
    })
    const updated = store.applyStoreUpdate('w1', {
      src: 'new src',
      iconUrl: 'https://example.com/new.svg',
      storeSha512: 'abc',
      storeVersion: '2.0.0',
    })
    expect(updated).toBe(store.getWidget('w1'))
    expect(store.getWidget('w1')).toMatchObject({
      src: 'new src',
      iconUrl: 'https://example.com/new.svg',
      storeSha512: 'abc',
      storeVersion: '2.0.0',
      // ローカル値は維持
      name: 'My Renamed',
      autoRun: true,
    })
  })

  it('ソース欠損の readOnly 個体は検証済み配布ソースで復旧する', () => {
    const store = useWidgetsStore()
    store.addWidget({ ...makeWidget('w1'), readOnly: true, src: '' })
    store.applyStoreUpdate('w1', {
      src: 'recovered',
      storeSha512: 'abc',
      storeVersion: '1.0.0',
    })
    expect(store.getWidget('w1')?.src).toBe('recovered')
    expect(store.getWidget('w1')?.readOnly).toBeFalsy()
  })

  it('未知の installId には undefined を返す', () => {
    const store = useWidgetsStore()
    expect(
      store.applyStoreUpdate('nope', {
        src: 's',
        storeSha512: 'a',
        storeVersion: '1',
      }),
    ).toBeUndefined()
  })
})

describe('編集履歴の同値ガード (#981)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(pushSnapshot).mockClear()
  })

  // localStorage ミラー経由で前テストの src を引き継がないよう id を分ける
  function addWidget(installId: string): WidgetMeta {
    const widget: WidgetMeta = {
      installId,
      name: 'hist',
      src: '<: "v1"',
      autoRun: false,
      createdAt: 0,
      updatedAt: 0,
      fileBase: 'hist',
    }
    useWidgetsStore().addWidget(widget)
    return widget
  }

  it('内容が変わる保存は編集前 snapshot を積む', () => {
    const w = addWidget('w-hist-changed')
    useWidgetsStore().updateSrc(w.installId, '<: "v2"')
    expect(pushSnapshot).toHaveBeenCalledTimes(1)
  })

  it('同じ内容の保存では積まない (自動保存でリングを使い潰さない)', () => {
    const w = addWidget('w-hist-same')
    useWidgetsStore().updateSrc(w.installId, '<: "v1"')
    expect(pushSnapshot).not.toHaveBeenCalled()
  })
})

describe('useWidgetsStore.setAccountKey — ウィジェット単位の実行アカウント (#1018 / #1061)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('実行アカウントを安定キーで固定できる', () => {
    const store = useWidgetsStore()
    store.addWidget(makeWidget('w-acc'))

    store.setAccountKey('w-acc', 'misskey.io:u1')

    expect(store.getWidget('w-acc')?.accountKey).toBe('misskey.io:u1')
  })

  it('undefined を渡すと解除される (カラムのアカウントに従う状態へ戻す)', () => {
    const store = useWidgetsStore()
    store.addWidget({ ...makeWidget('w-acc'), accountKey: 'misskey.io:u1' })

    store.setAccountKey('w-acc', undefined)

    expect(store.getWidget('w-acc')?.accountKey).toBeUndefined()
  })

  it('未知の installId は no-op', () => {
    const store = useWidgetsStore()
    expect(() => store.setAccountKey('missing', 'misskey.io:u1')).not.toThrow()
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

describe('useWidgetsStore.migrateScopes — 実行アカウントの安定キー化 (#1061)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  // 移行は初回ロード直後に 1 回だけ走るので、ロード前のデータとして仕込む
  function seed(...widgets: WidgetMeta[]) {
    setStorageJson(STORAGE_KEYS.widgets, widgets)
  }

  it('旧 accountId (UUID) が現行アカウントに該当すれば安定キーへ置換する', () => {
    setupAccounts()
    seed({ ...makeWidget('w1'), legacyAccountId: 'uuid-yami' })
    const store = useWidgetsStore()

    store.migrateScopes()

    const w = store.getWidget('w1')
    expect(w?.accountKey).toBe('yami.ski:u1')
    expect(w?.legacyAccountId).toBeUndefined()
  })

  it('ミラーに旧形式 (accountId) のまま残っている個体も移行する', () => {
    setupAccounts()
    // 旧バージョンの localStorage ミラーはファイルを経由せず accountId を直接持つ
    seed({ ...makeWidget('w1'), accountId: 'uuid-yami' } as WidgetMeta)
    const store = useWidgetsStore()

    store.migrateScopes()

    const w = store.getWidget('w1') as WidgetMeta & { accountId?: string }
    expect(w?.accountKey).toBe('yami.ski:u1')
    expect(w?.accountId).toBeUndefined()
  })

  it('旧 accountId が現存しないアカウントなら「アカウント無し」へ戻して救済する', () => {
    setupAccounts()
    seed({ ...makeWidget('w1'), legacyAccountId: 'uuid-dead' })
    const store = useWidgetsStore()

    store.migrateScopes()

    const w = store.getWidget('w1')
    expect(w?.accountKey).toBeUndefined()
    expect(w?.legacyAccountId).toBeUndefined()
  })

  it('現存しない安定キーも「アカウント無し」へ戻す (バックアップ復元の孤児)', () => {
    setupAccounts()
    seed(
      { ...makeWidget('w1'), accountKey: 'gone.example:u9' },
      { ...makeWidget('w2'), accountKey: 'yami.ski:u1' },
    )
    const store = useWidgetsStore()

    store.migrateScopes()

    expect(store.getWidget('w1')?.accountKey).toBeUndefined()
    expect(store.getWidget('w2')?.accountKey).toBe('yami.ski:u1')
  })

  it('accounts 未ロードなら何もしない', () => {
    seed({ ...makeWidget('w1'), legacyAccountId: 'uuid-yami' })
    const store = useWidgetsStore()

    store.migrateScopes()

    expect(store.getWidget('w1')?.legacyAccountId).toBe('uuid-yami')
  })
})

describe('useWidgetsStore.purgeAccount — アカウント削除で紐づく個体を消す (#1061)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('同じ安定キーの個体だけを削除し、削除した installId を返す', () => {
    const store = useWidgetsStore()
    store.addWidget({ ...makeWidget('w1'), accountKey: 'yami.ski:u1' })
    store.addWidget({ ...makeWidget('w2'), accountKey: 'cloud.example:u2' })
    store.addWidget(makeWidget('w3'))

    expect(store.purgeAccount('yami.ski:u1')).toEqual(['w1'])

    expect(store.widgets.map((w) => w.installId)).toEqual(['w2', 'w3'])
  })
})

describe('読取専用 (ソース欠損) のウィジェットは変更を拒否する (#1111)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('自動実行・改名・ソース・実行アカウントの変更を拒否して false を返す', () => {
    const store = useWidgetsStore()
    store.addWidget({ ...makeWidget('ro'), src: '' })
    const live = store.getWidget('ro')
    if (live) live.readOnly = true
    expect(store.setAutoRun('ro', true)).toBe(false)
    expect(store.getWidget('ro')?.autoRun).toBe(false)
    expect(store.renameWidget('ro', 'renamed')).toBe(false)
    expect(store.getWidget('ro')?.name).toBe('ro')
    expect(store.updateSrc('ro', 'x')).toBe(false)
    expect(store.setAccountKey('ro', 'h:u')).toBe(false)
    expect(store.getWidget('ro')?.accountKey).toBeUndefined()
  })

  it('通常のウィジェットでは true を返す', () => {
    const store = useWidgetsStore()
    store.addWidget(makeWidget('ok'))
    expect(store.setAutoRun('ok', true)).toBe(true)
    expect(store.renameWidget('ok', 'renamed')).toBe(true)
  })
})

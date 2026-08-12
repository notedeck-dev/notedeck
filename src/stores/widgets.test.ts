// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pushSnapshot } from '@/utils/historyFs'
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

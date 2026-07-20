// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWidgetsStore, type WidgetMeta } from './widgets'

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

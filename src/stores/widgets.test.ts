import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWidgetsStore } from './widgets'

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

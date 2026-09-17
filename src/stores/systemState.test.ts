import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { SystemState } from '@/bindings'

const spy = vi.hoisted(() => ({
  listen: vi.fn(),
  get: vi.fn(),
  toast: vi.fn(),
  staticMode: vi.fn(),
  order: [] as string[],
}))

vi.mock('@/bindings', () => ({
  events: {
    systemState: {
      listen: (handler: (e: { payload: SystemState }) => void) => {
        spy.order.push('listen')
        spy.listen(handler)
        return Promise.resolve(() => {
          /* unlisten */
        })
      },
    },
  },
  commands: {
    systemStateGet: () => {
      spy.order.push('get')
      return Promise.resolve({ status: 'ok', data: spy.get() })
    },
  },
}))
vi.mock('@/stores/toast', () => ({
  useToast: () => ({ show: spy.toast }),
}))
vi.mock('@/utils/mediaProxy', () => ({
  setEmojiStaticMode: spy.staticMode,
}))

import { useSystemStateStore } from '@/stores/systemState'

const NONE: SystemState = {
  onBattery: null,
  lowPowerMode: null,
  metered: null,
  doNotDisturb: null,
}

describe('useSystemStateStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    spy.listen.mockReset()
    spy.get.mockReset().mockReturnValue(NONE)
    spy.toast.mockReset()
    spy.staticMode.mockReset()
    spy.order = []
  })

  it('listen を張ってから初期値を取る (起動直後の変化を取りこぼさない)', async () => {
    const store = useSystemStateStore()
    spy.get.mockReturnValue({ ...NONE, onBattery: true })
    await store.start()
    expect(spy.order).toEqual(['listen', 'get'])
    expect(store.state.onBattery).toBe(true)
    expect(store.adaptation.suppressPrefetch).toBe(true)
  })

  it('event で状態が更新され、適応が入るときだけトーストを出す', async () => {
    const store = useSystemStateStore()
    await store.start()
    const handler = spy.listen.mock.calls[0]?.[0] as (e: {
      payload: SystemState
    }) => void
    handler({ payload: { ...NONE, metered: true } })
    await nextTick()
    expect(store.adaptation.deferMedia).toBe(true)
    expect(spy.toast).toHaveBeenCalledTimes(1)
    expect(spy.toast.mock.calls[0]?.[0]).toMatch(/従量制回線/)

    // 抜けるときは黙る
    handler({ payload: { ...NONE, metered: false } })
    await nextTick()
    expect(store.adaptation.deferMedia).toBe(false)
    expect(spy.toast).toHaveBeenCalledTimes(1)
  })

  it('絵文字の静止モードを mediaProxy に押し込む', async () => {
    const store = useSystemStateStore()
    await store.start()
    expect(spy.staticMode).toHaveBeenLastCalledWith(false)
    const handler = spy.listen.mock.calls[0]?.[0] as (e: {
      payload: SystemState
    }) => void
    handler({ payload: { ...NONE, lowPowerMode: true } })
    await nextTick()
    expect(spy.staticMode).toHaveBeenLastCalledWith(true)
  })

  it('自動調整 OFF にすると電源・回線の適応が解け、集中モードの消音は残る', async () => {
    const store = useSystemStateStore()
    spy.get.mockReturnValue({ ...NONE, onBattery: true, doNotDisturb: true })
    await store.start()
    expect(store.adaptation.staticEmoji).toBe(true)
    store.autoAdapt = false
    await nextTick()
    expect(store.adaptation.staticEmoji).toBe(false)
    expect(store.adaptation.muteSounds).toBe(true)
  })
})

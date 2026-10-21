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

describe('useSystemStateStore: 回線の有無 (#461)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    spy.listen.mockReset()
    spy.get.mockReset().mockReturnValue(NONE)
    spy.toast.mockReset()
    spy.staticMode.mockReset()
    spy.order = []
  })

  it('回線の有無を navigator.onLine と online / offline イベントで持つ (#461)', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    })
    const store = useSystemStateStore()
    await store.start()
    expect(store.online).toBe(false)
    expect(store.adaptation.goOffline).toBe(true)
    expect(spy.toast).toHaveBeenCalledTimes(1)
    expect(spy.toast.mock.calls[0]?.[0]).toMatch(/回線が切れ/)

    window.dispatchEvent(new Event('online'))
    await nextTick()
    expect(store.online).toBe(true)
    expect(store.adaptation.goOffline).toBe(false)

    window.dispatchEvent(new Event('offline'))
    await nextTick()
    expect(store.adaptation.goOffline).toBe(true)

    store.stop()
    window.dispatchEvent(new Event('online'))
    await nextTick()
    expect(store.online).toBe(false)
    Reflect.deleteProperty(navigator, 'onLine')
  })
})

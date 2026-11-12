import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOfflineModeStore } from '@/stores/offlineMode'

/**
 * 手動のオフラインモードの切替は Rust の専用の操作に載せる (#1350)。状態を書くのは
 * Rust だけで、書けなかったら画面をオフラインにしない (画面はオフラインなのに通信は
 * 出たまま、を作らない)。
 */

const h = vi.hoisted(() => ({
  stored: false,
  failSet: false,
  set: vi.fn(),
  updateCheck: vi.fn(),
  toast: vi.fn(),
  listeners: [] as ((e: { payload: { offline: boolean } }) => void)[],
}))

vi.mock('@/utils/settingsFs', async (original) => ({
  ...(await original<typeof import('@/utils/settingsFs')>()),
  isTauri: true,
}))
vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, name: string) => {
        return (...args: unknown[]) => {
          if (name === 'offlineModeGet') {
            return Promise.resolve({ status: 'ok', data: h.stored })
          }
          if (name === 'updateCheck') h.updateCheck(...args)
          if (name === 'offlineModeSet') {
            h.set(...args)
            if (h.failSet) {
              return Promise.resolve({
                status: 'error',
                error: { code: 'INVALID_INPUT', message: 'disk full' },
              })
            }
            h.stored = args[0] as boolean
          }
          return Promise.resolve({ status: 'ok', data: null })
        }
      },
    },
  ),
  events: {
    offlineModeChanged: {
      listen: (fn: (e: { payload: { offline: boolean } }) => void) => {
        h.listeners.push(fn)
        return Promise.resolve(() => undefined)
      },
    },
  },
}))
vi.mock('@/stores/toast', () => ({ useToast: () => ({ show: h.toast }) }))
// この窓を代表窓にする (プロセスに 1 回の仕事はここだけが頼む)
vi.mock('@/windows/roles', () => ({
  useRepresentative: () => ({ isRepresentative: { value: true } }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  h.stored = false
  h.failSet = false
  h.set.mockReset()
  h.updateCheck.mockReset()
  h.toast.mockReset()
  h.listeners.length = 0
})

describe('手動のオフラインモードの切替 (#1350)', () => {
  it('起動時に Rust の状態を読む', async () => {
    h.stored = true
    const store = useOfflineModeStore()
    await store.load()
    expect(store.isManualOffline).toBe(true)
    expect(store.isOfflineMode).toBe(true)
  })

  it('切替は Rust の操作を呼び、成功してから画面に反映する', async () => {
    const store = useOfflineModeStore()
    await store.load()
    await store.enable()
    expect(h.set).toHaveBeenCalledWith(true)
    expect(store.isManualOffline).toBe(true)

    await store.disable()
    expect(h.set).toHaveBeenLastCalledWith(false)
    expect(store.isManualOffline).toBe(false)
  })

  it('書けなかったら画面をオフラインにせず、失敗を見せる', async () => {
    const store = useOfflineModeStore()
    await store.load()
    h.failSet = true
    await store.enable()
    expect(store.isManualOffline).toBe(false)
    expect(h.toast).toHaveBeenCalledTimes(1)
  })

  it('解除したら更新確認を頼む (オフラインのまま起動すると確認していない)', async () => {
    h.stored = true
    const store = useOfflineModeStore()
    await store.load()
    expect(h.updateCheck).not.toHaveBeenCalled()
    await store.disable()
    expect(h.updateCheck).toHaveBeenCalledWith(false)
  })

  it('別の窓での切替が届いたら追従する', async () => {
    const store = useOfflineModeStore()
    await store.load()
    for (const fn of h.listeners) fn({ payload: { offline: true } })
    expect(store.isManualOffline).toBe(true)
  })
})

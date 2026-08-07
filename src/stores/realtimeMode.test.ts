import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { usePerformanceStore } from '@/stores/performance'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useSettingsStore } from '@/stores/settings'

const spy = vi.hoisted(() => ({ streamSetMode: vi.fn() }))

vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === 'streamSetMode') {
          return (...args: unknown[]) => {
            spy.streamSetMode(...args)
            return Promise.resolve({ status: 'ok', data: null })
          }
        }
        return () => Promise.resolve({ status: 'ok', data: null })
      },
    },
  ),
}))

function account(id: string, hasToken = true): Account {
  return {
    id,
    host: 'misskey.example',
    userId: `user-${id}`,
    username: id,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken,
  } satisfies Account
}

beforeEach(() => {
  setActivePinia(createPinia())
  spy.streamSetMode.mockReset()
})

describe('applyPersistedMode', () => {
  it('polling が永続されているとき、token を持つ全アカウントへ polling を適用する', () => {
    useSettingsStore().set('modes.realtime', false)
    const accounts = useAccountsStore()
    accounts.addAccount(account('acc1'))
    accounts.addAccount(account('acc2', false))

    useRealtimeModeStore().applyPersistedMode()

    const intervalMs = usePerformanceStore().get('streamPollingInterval') * 1000
    expect(spy.streamSetMode).toHaveBeenCalledTimes(1)
    expect(spy.streamSetMode).toHaveBeenCalledWith(
      'acc1',
      'polling',
      intervalMs,
    )
  })

  it('realtime が永続されているときは何も送らない (バックエンドの既定動作)', () => {
    useAccountsStore().addAccount(account('acc1'))

    useRealtimeModeStore().applyPersistedMode()

    expect(spy.streamSetMode).not.toHaveBeenCalled()
  })

  it('オフラインモード中はネットワークを起こさない', () => {
    useSettingsStore().set('modes.realtime', false)
    useSettingsStore().set('modes.offline', true)
    useAccountsStore().addAccount(account('acc1'))

    useRealtimeModeStore().applyPersistedMode()

    expect(spy.streamSetMode).not.toHaveBeenCalled()
  })
})

describe('オフラインモード解除', () => {
  it('polling モードなら輸送路を polling で再開する', async () => {
    useSettingsStore().set('modes.realtime', false)
    useSettingsStore().set('modes.offline', true)
    useAccountsStore().addAccount(account('acc1'))

    await useOfflineModeStore().disable()

    const intervalMs = usePerformanceStore().get('streamPollingInterval') * 1000
    expect(spy.streamSetMode).toHaveBeenCalledWith(
      'acc1',
      'polling',
      intervalMs,
    )
  })

  it('realtime モードなら何も送らない (復帰は deck-resume 経由の connect に委ねる)', async () => {
    useSettingsStore().set('modes.offline', true)
    useAccountsStore().addAccount(account('acc1'))

    await useOfflineModeStore().disable()

    expect(spy.streamSetMode).not.toHaveBeenCalled()
  })
})

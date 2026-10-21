import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useSettingsStore } from '@/stores/settings'
import { useSystemStateStore } from '@/stores/systemState'
import { useUiStore } from '@/stores/ui'

const spy = vi.hoisted(() => ({
  streamDisconnect: vi.fn(),
  streamSetMode: vi.fn(),
}))

vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get: (_t, name: string) => {
        return (...args: unknown[]) => {
          if (name === 'streamDisconnect') spy.streamDisconnect(...args)
          if (name === 'streamSetMode') spy.streamSetMode(...args)
          return Promise.resolve({ status: 'ok', data: null })
        }
      },
    },
  ),
  events: {},
}))
vi.mock('@/stores/toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}))

function account(id: string): Account {
  return {
    id,
    host: 'misskey.example',
    userId: `user-${id}`,
    username: id,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
  } satisfies Account
}

beforeEach(() => {
  setActivePinia(createPinia())
  spy.streamDisconnect.mockReset()
  spy.streamSetMode.mockReset()
  useAccountsStore().addAccount(account('acc1'))
})

describe('回線断による自動オフライン (#461)', () => {
  it('回線が切れたらオフラインモードに入ってストリームを切り、戻ったら抜けて復帰信号を出す', async () => {
    const offline = useOfflineModeStore()
    const system = useSystemStateStore()
    const ui = useUiStore()
    useSettingsStore().set('modes.realtime', false)

    system.online = false
    await nextTick()
    expect(offline.isOfflineMode).toBe(true)
    expect(offline.isAutoOffline).toBe(true)
    expect(spy.streamDisconnect).toHaveBeenCalledWith('acc1')
    // 設定ファイルの手動フラグは触らない
    expect(useSettingsStore().get('modes.offline')).toBeFalsy()

    system.online = true
    await nextTick()
    expect(offline.isOfflineMode).toBe(false)
    expect(spy.streamSetMode).toHaveBeenCalledWith(
      'acc1',
      'polling',
      expect.any(Number),
    )
    expect(ui.deckResumeSignal).toBe(1)
  })

  it('手動で入れたオフラインモードは回線が戻っても抜けない', async () => {
    const offline = useOfflineModeStore()
    const system = useSystemStateStore()
    const ui = useUiStore()

    await offline.enable()
    system.online = false
    await nextTick()
    system.online = true
    await nextTick()
    expect(offline.isOfflineMode).toBe(true)
    expect(offline.isAutoOffline).toBe(false)
    expect(ui.deckResumeSignal).toBe(0)
  })

  it('自動オフライン中に利用者が解除したら、次に回線が切れるまで自動を抑止する', async () => {
    const offline = useOfflineModeStore()
    const system = useSystemStateStore()
    const ui = useUiStore()

    system.online = false
    await nextTick()
    expect(offline.isOfflineMode).toBe(true)

    await offline.disable()
    await nextTick()
    expect(offline.isOfflineMode).toBe(false)
    expect(ui.deckResumeSignal).toBe(1)

    // 回線が戻って、また切れたら再び自動で入る
    system.online = true
    await nextTick()
    system.online = false
    await nextTick()
    expect(offline.isOfflineMode).toBe(true)
  })

  it('自動調整 OFF なら回線断で入らない', async () => {
    const offline = useOfflineModeStore()
    const system = useSystemStateStore()
    system.autoAdapt = false

    system.online = false
    await nextTick()
    expect(offline.isOfflineMode).toBe(false)
    expect(spy.streamDisconnect).not.toHaveBeenCalled()
  })

  it('手動の切替は従来どおりストリーム切断と復帰信号を出す', async () => {
    const offline = useOfflineModeStore()
    const ui = useUiStore()

    await offline.toggle()
    await nextTick()
    expect(offline.isOfflineMode).toBe(true)
    expect(spy.streamDisconnect).toHaveBeenCalledWith('acc1')

    await offline.toggle()
    await nextTick()
    expect(offline.isOfflineMode).toBe(false)
    expect(ui.deckResumeSignal).toBe(1)
  })
})

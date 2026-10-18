// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, nextTick } from 'vue'
import { SYNC_RETRY_MIN_INTERVAL_MS } from '@/services/muteExpiry'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { useAccountSync } from './useAccountSync'

const NOW = new Date('2026-10-18T06:00:00.000Z').getTime()
let app: App | null = null

function account(id: string, hasToken = true): Account {
  return {
    id,
    host: 'example.test',
    userId: `${id}-user`,
    username: id,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken,
  }
}

async function mountWith(
  accounts: Account[],
  sync: (accountId: string, host: string) => Promise<void>,
  onResume?: () => void,
) {
  useAccountsStore().accounts = accounts
  const Host = defineComponent({
    setup() {
      useAccountSync('test-sync', sync, onResume)
      return () => null
    },
  })
  app = createApp(Host)
  app.mount(document.createElement('div'))
  await flush()
}

async function flush() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function resume() {
  useUiStore().emitDeckResume()
  await flush()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  app?.unmount()
  app = null
  vi.useRealTimers()
})

describe('useAccountSync: アカウントごとの起動時同期と再試行 (#1260)', () => {
  it('認証済みのアカウントだけ 1 回同期し、復帰しても取り直さない', async () => {
    const sync = vi.fn(async () => undefined)
    await mountWith([account('a'), account('guest', false)], sync)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith('a', 'example.test')
    await resume()
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('失敗したら間隔が空いたあとの復帰信号で取り直す (アカウント単位)', async () => {
    const sync = vi
      .fn<(id: string, host: string) => Promise<void>>()
      .mockImplementation(async (id) => {
        if (
          id === 'b' &&
          sync.mock.calls.filter(([x]) => x === 'b').length === 1
        )
          throw new AppError('NETWORK', 'offline')
      })
    await mountWith([account('a'), account('b')], sync)
    expect(sync).toHaveBeenCalledTimes(2)
    vi.setSystemTime(NOW + SYNC_RETRY_MIN_INTERVAL_MS - 1)
    await resume()
    expect(sync).toHaveBeenCalledTimes(2)
    vi.setSystemTime(NOW + SYNC_RETRY_MIN_INTERVAL_MS)
    await resume()
    expect(sync).toHaveBeenCalledTimes(3)
    expect(sync).toHaveBeenLastCalledWith('b', 'example.test')
  })

  it('認証エラーは復帰信号で取り直さない', async () => {
    const sync = vi.fn(async () => {
      throw new AppError('AUTH_SESSION_INVALID', 'expired')
    })
    await mountWith([account('a')], sync)
    vi.setSystemTime(NOW + 2 * SYNC_RETRY_MIN_INTERVAL_MS)
    await resume()
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('復帰信号で onResume を呼ぶ', async () => {
    const onResume = vi.fn()
    await mountWith([account('a')], async () => undefined, onResume)
    await resume()
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('ログアウトして再ログインしたら取り直す', async () => {
    const sync = vi.fn(async () => undefined)
    await mountWith([account('a')], sync)
    const acc = useAccountsStore().accounts.find((a) => a.id === 'a')
    if (!acc) throw new Error('account a not found')
    acc.hasToken = false
    await flush()
    acc.hasToken = true
    await flush()
    expect(sync).toHaveBeenCalledTimes(2)
  })
})

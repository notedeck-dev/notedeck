// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, nextTick } from 'vue'
import { SYNC_RETRY_MIN_INTERVAL_MS } from '@/services/muteExpiry'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useMutesStore } from '@/stores/mutes'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'

const getMutedUsers = vi.fn()
vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async () => ({
    adapter: { api: { getMutedUsers } },
  })),
}))

import { useMuteSync } from './useMuteSync'

const NOW = new Date('2026-10-18T06:00:00.000Z').getTime()
const DAY = 86_400_000

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

async function mountWith(accounts: Account[]) {
  const accountsStore = useAccountsStore()
  accountsStore.accounts = accounts
  const Host = defineComponent({
    setup() {
      useMuteSync()
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
  getMutedUsers.mockReset()
})

afterEach(() => {
  app?.unmount()
  app = null
  vi.useRealTimers()
})

describe('useMuteSync: 同期で取り込んだ期限つきミュート (#1260)', () => {
  it('起動時に取り込み、期限つきは期限で手元の非表示が戻る', async () => {
    getMutedUsers.mockResolvedValue([
      { userId: 'forever', expiresAt: null },
      { userId: 'soon', expiresAt: NOW + DAY },
    ])
    await mountWith([account('a')])
    const mutes = useMutesStore()
    expect(mutes.isUserMuted('a', 'soon')).toBe(true)
    expect(mutes.mutedUntil('a', 'soon')).toBe(NOW + DAY)
    vi.advanceTimersByTime(DAY)
    expect(mutes.isUserMuted('a', 'soon')).toBe(false)
    expect(mutes.isUserMuted('a', 'forever')).toBe(true)
  })

  it('復帰信号で眠っている間に期限が過ぎたミュートを片付ける', async () => {
    getMutedUsers.mockResolvedValue([{ userId: 'u', expiresAt: NOW + DAY }])
    await mountWith([account('a')])
    vi.setSystemTime(NOW + 2 * DAY) // スリープ: timer は進まず壁時計だけ進む
    await resume()
    expect(useMutesStore().isUserMuted('a', 'u')).toBe(false)
  })

  it('取り込みに失敗したら、間隔が空いたあとの復帰信号で取り直す', async () => {
    getMutedUsers
      .mockRejectedValueOnce(new AppError('NETWORK', 'offline'))
      .mockResolvedValue([{ userId: 'u', expiresAt: null }])
    await mountWith([account('a')])
    expect(useMutesStore().isUserMuted('a', 'u')).toBe(false)

    vi.setSystemTime(NOW + SYNC_RETRY_MIN_INTERVAL_MS - 1)
    await resume()
    expect(getMutedUsers).toHaveBeenCalledTimes(1)

    vi.setSystemTime(NOW + SYNC_RETRY_MIN_INTERVAL_MS)
    await resume()
    expect(getMutedUsers).toHaveBeenCalledTimes(2)
    expect(useMutesStore().isUserMuted('a', 'u')).toBe(true)

    // 取り込めたあとは復帰しても取り直さない (再同期は範囲外)
    await resume()
    expect(getMutedUsers).toHaveBeenCalledTimes(2)
  })

  it('認証エラーで失敗したら復帰信号でも取り直さない', async () => {
    getMutedUsers.mockRejectedValue(
      new AppError('AUTH_SESSION_INVALID', 'expired'),
    )
    await mountWith([account('a')])
    vi.setSystemTime(NOW + 2 * SYNC_RETRY_MIN_INTERVAL_MS)
    await resume()
    expect(getMutedUsers).toHaveBeenCalledTimes(1)
  })

  it('ログアウトして再ログインしたら取り直す', async () => {
    getMutedUsers.mockResolvedValue([])
    await mountWith([account('a')])
    expect(getMutedUsers).toHaveBeenCalledTimes(1)
    const acc = useAccountsStore().accounts.find((a) => a.id === 'a')
    if (!acc) throw new Error('account a not found')
    acc.hasToken = false
    await flush()
    acc.hasToken = true
    await flush()
    expect(getMutedUsers).toHaveBeenCalledTimes(2)
  })
})

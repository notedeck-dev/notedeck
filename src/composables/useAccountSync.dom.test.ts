// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, nextTick } from 'vue'
import {
  RESYNC_MIN_INTERVAL_MS,
  SYNC_RETRY_MIN_INTERVAL_MS,
} from '@/services/muteExpiry'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { useAccountSync } from './useAccountSync'

const { showPermissionReloginPrompt } = vi.hoisted(() => ({
  showPermissionReloginPrompt: vi.fn(),
}))
vi.mock('@/composables/useLoginPrompt', () => ({ showPermissionReloginPrompt }))

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
  sync: (accountId: string, host: string, startSeq: number) => Promise<void>,
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
  it('認証済みのアカウントだけ 1 回同期し、間隔内の復帰では取り直さない', async () => {
    const sync = vi.fn(async () => undefined)
    await mountWith([account('a'), account('guest', false)], sync)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledWith('a', 'example.test', expect.any(Number))
    vi.setSystemTime(NOW + RESYNC_MIN_INTERVAL_MS - 1)
    await resume()
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('同期済みのアカウントも間隔が空いた復帰で取り込み直す (始めた順の採番つき、#1268)', async () => {
    const sync = vi.fn<
      (id: string, host: string, seq: number) => Promise<void>
    >(async () => undefined)
    await mountWith([account('a')], sync)
    vi.setSystemTime(NOW + RESYNC_MIN_INTERVAL_MS)
    await resume()
    expect(sync).toHaveBeenCalledTimes(2)
    const [first, second] = sync.mock.calls.map((c) => c[2])
    expect(second).toBeGreaterThan(first as number)
    // 直後の復帰では取り直さない
    await resume()
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('時計が戻った復帰では間隔を待たずに取り込み直す', async () => {
    const sync = vi.fn(async () => undefined)
    await mountWith([account('a')], sync)
    vi.setSystemTime(NOW - 60 * 60_000)
    await resume()
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('取り込み直しが失敗しても、間隔が空いた次の復帰で取り直す', async () => {
    const sync = vi
      .fn<(id: string, host: string, startSeq: number) => Promise<void>>()
      .mockImplementation(async () => {
        if (sync.mock.calls.length === 2) throw new AppError('NETWORK', 'x')
      })
    await mountWith([account('a')], sync)
    vi.setSystemTime(NOW + RESYNC_MIN_INTERVAL_MS)
    await resume()
    expect(sync).toHaveBeenCalledTimes(2)
    vi.setSystemTime(NOW + RESYNC_MIN_INTERVAL_MS + SYNC_RETRY_MIN_INTERVAL_MS)
    await resume()
    expect(sync).toHaveBeenCalledTimes(3)
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
    expect(sync).toHaveBeenLastCalledWith(
      'b',
      'example.test',
      expect.any(Number),
    )
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

  // 権限 (read:mutes など) は後から要求に足したので、以前のトークンのままの口座は
  // 何度打っても通らない (#1359)
  it('権限不足は復帰信号で取り直さず、再ログインを 1 回案内する', async () => {
    showPermissionReloginPrompt.mockClear()
    const sync = vi.fn(async () => {
      throw new AppError('API', 'denied', 'PERMISSION_DENIED')
    })
    await mountWith([account('a')], sync)
    expect(showPermissionReloginPrompt).toHaveBeenCalledWith(
      'a',
      expect.stringContaining('ミュートの同期'),
    )
    vi.setSystemTime(NOW + 2 * SYNC_RETRY_MIN_INTERVAL_MS)
    await resume()
    expect(sync).toHaveBeenCalledTimes(1)
    expect(showPermissionReloginPrompt).toHaveBeenCalledTimes(1)
  })

  it('権限不足のあとログインし直したら取り直す', async () => {
    let denied = true
    const sync = vi.fn(async () => {
      if (denied) throw new AppError('API', 'denied', 'PERMISSION_DENIED')
    })
    await mountWith([account('a')], sync)
    denied = false
    // ログインし直すと同じ口座の行が新しいトークンのもので置き換わる
    useAccountsStore().accounts[0] = account('a')
    await flush()
    expect(sync).toHaveBeenCalledTimes(2)
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

  it('オフラインモード中は同期を見送り、解除で取りに行く (#1350)', async () => {
    const sync = vi.fn(async () => undefined)
    const offline = useOfflineModeStore()
    await offline.enable()
    await mountWith([account('a')], sync)
    expect(sync).not.toHaveBeenCalled()

    // 解除は復帰の信号を出す
    await offline.disable()
    await flush()
    expect(sync).toHaveBeenCalledTimes(1)
  })
})

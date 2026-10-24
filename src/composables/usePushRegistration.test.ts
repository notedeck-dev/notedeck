import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePushRegistration } from './usePushRegistration'

/**
 * push の登録 (#330)。全サーバーの状態をまとめて読み、オン / オフ / プッシュ通知アプリの
 * 選択のあとで読み直す。失敗は理由 (problem) で返り、例外にしない。
 */

const ok = <T>(data: T) => Promise.resolve({ status: 'ok' as const, data })
const fail = () =>
  Promise.resolve({
    status: 'error' as const,
    error: {
      code: 'NETWORK',
      message: 'offline',
      apiCode: null,
      i18n: null,
      retryAfterMs: null,
    },
  })

const { pushOverview, pushPrepare, pushDisable, pushChooseDistributor } =
  vi.hoisted(() => ({
    pushOverview: vi.fn(),
    pushPrepare: vi.fn(),
    pushDisable: vi.fn(),
    pushChooseDistributor: vi.fn(),
  }))

vi.mock('@/bindings', () => ({
  commands: {
    pushOverview,
    pushPrepare,
    pushDisable,
    pushChooseDistributor,
  },
}))

const status = (code: string | null) => ({
  distributor: 'ready',
  apps: [{ package: 'io.heckel.ntfy', label: 'ntfy', active: true }],
  hosts: [
    {
      host: 'h',
      accounts: [
        {
          accountId: 'acct-1',
          state: code ? 'pending' : 'off',
          reason: null,
          awaiting: false,
          resent: false,
        },
      ],
      code,
      scratchpadUrl: 'https://h/scratchpad',
    },
  ],
})

describe('usePushRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushOverview.mockImplementation(() => ok(status(null)))
  })

  it('口座をオンにすると、読み直した状態にコードが載る', async () => {
    const push = usePushRegistration()
    await push.refresh()
    expect(push.status.value?.hosts[0]?.code).toBeNull()

    pushPrepare.mockImplementation(() => ok(null))
    pushOverview.mockImplementation(() => ok(status('let PASS = 1')))
    await push.prepare('acct-1')
    expect(pushPrepare).toHaveBeenCalledWith('acct-1')
    expect(push.problem.value).toBeNull()
    expect(push.status.value?.hosts[0]?.code).toBe('let PASS = 1')
  })

  it('準備の失敗は理由として残る', async () => {
    const push = usePushRegistration()
    pushPrepare.mockImplementation(() => ok('serverUnsupported'))
    await push.prepare('acct-1')
    expect(push.problem.value).toBe('serverUnsupported')
  })

  it('選べなくて止まったオンは、プッシュ通知アプリを選んだ後にやり直す', async () => {
    const push = usePushRegistration()
    pushPrepare.mockImplementation(() => ok('chooseDistributor'))
    await push.prepare('acct-1')
    expect(push.problem.value).toBe('chooseDistributor')

    pushChooseDistributor.mockImplementation(() => ok(null))
    pushPrepare.mockImplementation(() => ok(null))
    await push.choose('io.heckel.ntfy')
    expect(pushChooseDistributor).toHaveBeenCalledWith('io.heckel.ntfy')
    expect(pushPrepare).toHaveBeenLastCalledWith('acct-1')
    expect(push.problem.value).toBeNull()
  })

  it('止まっていなければ、プッシュ通知アプリを選んでも読み直すだけ', async () => {
    const push = usePushRegistration()
    pushChooseDistributor.mockImplementation(() => ok(null))
    await push.choose('org.unifiedpush.distributor.sunup')
    expect(pushPrepare).not.toHaveBeenCalled()
    expect(pushOverview).toHaveBeenCalled()
  })

  it('やめるのに失敗したら状態を読み直さず、エラーを残す', async () => {
    const push = usePushRegistration()
    pushDisable.mockImplementation(fail)
    await push.disable('acct-1')
    expect(push.error.value).not.toBeNull()
    expect(pushOverview).not.toHaveBeenCalled()
  })

  it('読み直しが重なったら後の方は捨てる', async () => {
    const push = usePushRegistration()
    await Promise.all([push.refresh(), push.refresh()])
    expect(pushOverview).toHaveBeenCalledTimes(1)
  })
})

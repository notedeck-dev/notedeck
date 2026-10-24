import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePushRegistration, usePushState } from './usePushRegistration'

/**
 * push の登録 (#330)。サーバー単位の状態を読み、準備・やり直し・やめるのあとで
 * 読み直す。失敗は理由 (problem) で返り、例外にしない。
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

const {
  pushStatus,
  pushHostStatus,
  pushPrepare,
  pushRedo,
  pushDisable,
  pushDistributors,
  pushChooseDistributor,
} = vi.hoisted(() => ({
  pushStatus: vi.fn(),
  pushHostStatus: vi.fn(),
  pushPrepare: vi.fn(),
  pushRedo: vi.fn(),
  pushDisable: vi.fn(),
  pushDistributors: vi.fn(),
  pushChooseDistributor: vi.fn(),
}))

vi.mock('@/bindings', () => ({
  commands: {
    pushStatus,
    pushHostStatus,
    pushPrepare,
    pushRedo,
    pushDisable,
    pushDistributors,
    pushChooseDistributor,
  },
}))

const status = (code: string | null) => ({
  distributor: 'ready',
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
})

describe('usePushRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushHostStatus.mockImplementation(() => ok(status(null)))
  })

  it('準備するとサーバー単位で呼び、読み直した状態にコードが載る', async () => {
    const push = usePushRegistration(() => 'h')
    await push.refresh()
    expect(push.status.value?.code).toBeNull()

    pushPrepare.mockImplementation(() => ok(null))
    pushHostStatus.mockImplementation(() => ok(status('let PASS = 1')))
    await push.prepare()
    expect(pushPrepare).toHaveBeenCalledWith('h')
    expect(push.problem.value).toBeNull()
    expect(push.status.value?.code).toBe('let PASS = 1')
  })

  it('準備の失敗は理由として残る', async () => {
    const push = usePushRegistration(() => 'h')
    pushPrepare.mockImplementation(() => ok('serverUnsupported'))
    await push.prepare()
    expect(push.problem.value).toBe('serverUnsupported')
  })

  it('やり直しは口座ごと、プッシュ通知アプリを選んだら準備し直す', async () => {
    const push = usePushRegistration(() => 'h')
    pushRedo.mockImplementation(() => ok(null))
    await push.redo('acct-1')
    expect(pushRedo).toHaveBeenCalledWith('acct-1')

    pushChooseDistributor.mockImplementation(() => ok(null))
    pushPrepare.mockImplementation(() => ok(null))
    await push.choose('io.heckel.ntfy')
    expect(pushChooseDistributor).toHaveBeenCalledWith('io.heckel.ntfy')
    expect(pushPrepare).toHaveBeenCalledWith('h')
  })

  it('やめるのに失敗したら状態を読み直さず、エラーを残す', async () => {
    const push = usePushRegistration(() => 'h')
    pushDisable.mockImplementation(fail)
    await push.disable('acct-1')
    expect(push.error.value).not.toBeNull()
    expect(pushHostStatus).not.toHaveBeenCalled()
  })

  it('読み直しが重なったら後の方は捨てる', async () => {
    const push = usePushRegistration(() => 'h')
    await Promise.all([push.refresh(), push.refresh()])
    expect(pushHostStatus).toHaveBeenCalledTimes(1)
  })
})

describe('usePushState', () => {
  it('口座の状態を読み、読めなければ null', async () => {
    pushStatus.mockImplementation(() => ok('active'))
    const push = usePushState(() => 'acct-1')
    await push.refresh()
    expect(push.state.value).toBe('active')
    pushStatus.mockImplementation(fail)
    await push.refresh()
    expect(push.state.value).toBeNull()
  })
})

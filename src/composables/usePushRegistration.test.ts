import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePushRegistration } from './usePushRegistration'

/**
 * push の登録 (#330 §5)。状態を読み、準備でコードを受け取り、本家で実行した応答を
 * 貼って確定する。失敗は理由 (problem) で返り、例外にしない。
 */

const ok = <T>(data: T) => Promise.resolve({ status: 'ok' as const, data })

const { pushStatus, pushPrepare, pushComplete, pushDisable } = vi.hoisted(
  () => ({
    pushStatus: vi.fn(),
    pushPrepare: vi.fn(),
    pushComplete: vi.fn(),
    pushDisable: vi.fn(),
  }),
)

vi.mock('@/bindings', () => ({
  commands: { pushStatus, pushPrepare, pushComplete, pushDisable },
}))

describe('usePushRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushStatus.mockImplementation(() => ok('off'))
  })

  it('準備でコードと Scratchpad の URL を受け取り、応答を貼ると状態を読み直す', async () => {
    const push = usePushRegistration(() => 'acct-1')
    await push.refresh()
    expect(push.status.value).toBe('off')

    pushPrepare.mockImplementation(() =>
      ok({
        prepared: { code: 'code', scratchpadUrl: 'https://h/scratchpad' },
        problem: null,
      }),
    )
    await push.prepare()
    expect(pushPrepare).toHaveBeenCalledWith('acct-1')
    expect(push.prepared.value?.scratchpadUrl).toBe('https://h/scratchpad')
    expect(push.problem.value).toBeNull()

    pushComplete.mockImplementation(() => ok(null))
    pushStatus.mockImplementation(() => ok('active'))
    expect(await push.complete('{"state":"subscribed"}')).toBe(true)
    expect(pushComplete).toHaveBeenCalledWith(
      'acct-1',
      '{"state":"subscribed"}',
    )
    expect(push.prepared.value).toBeNull()
    expect(push.status.value).toBe('active')
  })

  it('準備や確定の失敗は理由として残り、コードは消さない (貼り直せる)', async () => {
    const push = usePushRegistration(() => 'acct-1')
    pushPrepare.mockImplementation(() =>
      ok({ prepared: null, problem: 'serverUnsupported' }),
    )
    await push.prepare()
    expect(push.problem.value).toBe('serverUnsupported')
    expect(push.prepared.value).toBeNull()

    pushPrepare.mockImplementation(() =>
      ok({ prepared: { code: 'c', scratchpadUrl: 'u' }, problem: null }),
    )
    await push.prepare()
    pushComplete.mockImplementation(() => ok('otherAccount'))
    expect(await push.complete('{}')).toBe(false)
    expect(push.problem.value).toBe('otherAccount')
    expect(push.prepared.value?.code).toBe('c')
  })

  it('やめるのに失敗したら状態を読み直さず、エラーを残す', async () => {
    const push = usePushRegistration(() => 'acct-1')
    pushDisable.mockImplementation(() =>
      Promise.resolve({
        status: 'error' as const,
        error: { code: 'KEYCHAIN', message: 'locked' },
      }),
    )
    await push.disable()
    expect(pushStatus).not.toHaveBeenCalled()
    expect(push.error.value).toBeTruthy()
  })

  it('やめると状態を読み直す。IPC の失敗は error に入れて投げない', async () => {
    const push = usePushRegistration(() => 'acct-1')
    pushDisable.mockImplementation(() => ok(null))
    await push.disable()
    expect(pushDisable).toHaveBeenCalledWith('acct-1')
    expect(pushStatus).toHaveBeenCalled()

    pushPrepare.mockImplementation(() =>
      Promise.resolve({
        status: 'error' as const,
        error: { code: 'NETWORK', message: 'offline' },
      }),
    )
    await push.prepare()
    expect(push.error.value).toBeTruthy()
    expect(push.busy.value).toBe(false)
  })
})

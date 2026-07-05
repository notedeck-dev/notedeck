// permissions_sync (Rust external gate への同期) の一時障害リトライ (#718)。
// sync を握りつぶすと Rust gate が古い広い権限のまま動くため、一時的な失敗は
// リトライで回復させる。permissionsSync を「N 回失敗して成功」に設定し検証。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let syncCalls = 0
let syncFailuresRemaining = 0
let lockdownCalls = 0

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  readPermissionsSettings: () =>
    Promise.resolve(JSON.stringify({ principals: {} })),
  readAiSettings: () => Promise.resolve(''),
  writeAiSettings: () => Promise.resolve(),
  writePermissionsSettings: () => Promise.resolve(),
}))

vi.mock('@/utils/tauriInvoke', () => ({
  commands: {
    permissionsSync: () => {
      syncCalls++
      if (syncFailuresRemaining > 0) {
        syncFailuresRemaining--
        return Promise.reject(new Error('sync failed'))
      }
      return Promise.resolve({ status: 'ok', data: null })
    },
    permissionsLockdown: () => {
      lockdownCalls++
      return Promise.resolve({ status: 'ok', data: null })
    },
  },
  unwrap: (r: unknown) => r,
}))

beforeEach(() => {
  syncCalls = 0
  syncFailuresRemaining = 0
  lockdownCalls = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('syncExternalToRust リトライ (#718)', () => {
  it('一時的な sync 失敗はリトライで回復する', async () => {
    const {
      _resetPermissionsForTest,
      usePermissionsConfig,
      reloadPermissionsConfig,
    } = await import('./store')
    _resetPermissionsForTest()
    // 初回 init 経由の sync を先に流し切り、_initStarted=true にしてから
    // カウントをリセットする (reloadPermissionsConfig の二重 sync 経路を避ける)
    usePermissionsConfig()
    await vi.runAllTimersAsync()
    syncCalls = 0
    syncFailuresRemaining = 2 // 2 回失敗 → 3 回目で成功

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = reloadPermissionsConfig()
    await vi.runAllTimersAsync()
    await done

    expect(syncCalls).toBe(3)
    // 回復したので恒久失敗の警告は出ず、lockdown も呼ばれない
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('permissions_sync failed'),
      ),
    ).toBe(false)
    expect(lockdownCalls).toBe(0)
    warn.mockRestore()
  })

  it('リトライを使い切ったら警告を残して throw しない', async () => {
    const {
      _resetPermissionsForTest,
      usePermissionsConfig,
      reloadPermissionsConfig,
    } = await import('./store')
    _resetPermissionsForTest()
    usePermissionsConfig()
    await vi.runAllTimersAsync()
    syncCalls = 0
    syncFailuresRemaining = 99 // 常に失敗

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done = reloadPermissionsConfig()
    await vi.runAllTimersAsync()
    await expect(done).resolves.toBeUndefined()

    expect(syncCalls).toBe(3) // MAX_ATTEMPTS
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('permissions_sync failed after 3 attempts'),
      ),
    ).toBe(true)
    // 失敗確定後は Rust gate をフェイルセーフに倒す (#718)
    expect(lockdownCalls).toBe(1)
    warn.mockRestore()
  })
})

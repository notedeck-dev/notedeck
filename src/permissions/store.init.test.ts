// permissions.json5 の初回読込 (async) と起動直後の判定のレース (#716)。
// autoRun ウィジェットが読込完了前に dispatch へ到達すると、confirmSkips が
// 空のデフォルト値で判定されて「今後確認しない」の記憶が効かない。
// settingsFs をモックして読込を保留し、whenPermissionsReady の待機を検証する。
import { describe, expect, it, vi } from 'vitest'

let resolveRead: ((content: string) => void) | undefined

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  readPermissionsSettings: () =>
    new Promise<string>((resolve) => {
      resolveRead = resolve
    }),
  readAiSettings: () => Promise.resolve(''),
  writeAiSettings: () => Promise.resolve(),
  writePermissionsSettings: () => Promise.resolve(),
}))

vi.mock('@/utils/tauriInvoke', () => ({
  commands: {
    permissionsSync: () => Promise.resolve({ status: 'ok', data: null }),
  },
  unwrap: (r: unknown) => r,
}))

describe('whenPermissionsReady (#716)', () => {
  it('読込完了前は解決せず、完了後に confirmSkips が反映される', async () => {
    const { whenPermissionsReady, isConfirmSkipped } = await import('./store')

    let ready = false
    const p = whenPermissionsReady().then(() => {
      ready = true
    })

    // 読込が保留されている間は resolve されない
    await Promise.resolve()
    await Promise.resolve()
    expect(ready).toBe(false)
    // この時点で判定するとデフォルト値 (confirmSkips 空) — これがバグの再現
    expect(isConfirmSkipped('plugin:widget:w1', 'http.fetch')).toBe(false)

    resolveRead?.(
      JSON.stringify({
        confirmSkips: { 'plugin:widget:w1': ['http.fetch'] },
      }),
    )
    await p
    expect(ready).toBe(true)
    expect(isConfirmSkipped('plugin:widget:w1', 'http.fetch')).toBe(true)
  })

  it('Mk:api gate も読込完了を待ち、制限済みプロファイルで判定する', async () => {
    const { _resetPermissionsForTest } = await import('./store')
    const { assertMisskeyApiAllowed } = await import('./misskeyApiGate')
    _resetPermissionsForTest()

    // plugin=readonly に制限したユーザーの起動直後を再現。読込前のデフォルト
    // (safe) は notes.react を許可するので、待たずに判定すると許可側に倒れる
    let settled = false
    const p = assertMisskeyApiAllowed(
      { kind: 'plugin', pluginId: 'w1' },
      'notes/reactions/create',
    ).finally(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveRead?.(
      JSON.stringify({
        principals: { plugin: { preset: 'readonly', custom: {} } },
      }),
    )
    await expect(p).rejects.toThrow(/permission_denied.*notes\.react/)
  })
})

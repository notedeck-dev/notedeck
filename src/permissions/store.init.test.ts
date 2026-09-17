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

  it('破損した permissions.json5 は最小権限へフォールバックし、トーストで通知する (#719 #722)', async () => {
    const {
      _resetPermissionsForTest,
      whenPermissionsReady,
      resolveForProfiled,
    } = await import('./store')
    const { useToast } = await import('@/stores/toast')
    _resetPermissionsForTest()
    // 直前のテストのトーストを消しておく
    const { toasts } = useToast()
    toasts.value = []

    // 初回読込をトリガし、readPermissionsSettings が呼ばれて resolveRead が
    // 再代入されるまでマイクロタスクを進めてから、パース不能な内容を返す
    const ready = whenPermissionsReady()
    await Promise.resolve()
    await Promise.resolve()
    resolveRead?.('{ this is not valid json5 ,,,')
    await ready

    // デフォルト (plugin=safe) なら notes.react は許可されるが、破損時は
    // readonly へ倒れるので拒否される (無言の権限拡大を防ぐ)
    const plugin = resolveForProfiled('plugin')
    expect(plugin['notes.react']).toBe(false)
    // 無言で狭めず warning トーストで知らせる (#722)
    const warn = toasts.value.find((t) => t.type === 'warning')
    expect(warn?.text).toContain('最小権限で起動')
  })
})

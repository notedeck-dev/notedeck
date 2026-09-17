// 権限の保存に失敗したときは fail-closed にする (#1099)。書けなかった変更を
// メモリに残すと、UI は絞ったつもりでも Rust 側 (ファイルを読む external gate)
// は旧権限のまま動く。永続状態へ戻し、トーストで知らせる。
import { describe, expect, it, vi } from 'vitest'

const toastCalls: Array<{ text: string; type: string }> = []
vi.mock('@/stores/toast', () => ({
  useToast: () => ({
    show: (text: string, type = 'info') => {
      toastCalls.push({ text, type })
    },
    dismiss: () => undefined,
    toasts: { value: [] },
  }),
}))

// 永続状態: external = readonly。書き込みは常に失敗する
vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  readPermissionsSettings: () =>
    Promise.resolve(
      JSON.stringify({ principals: { external: { preset: 'readonly' } } }),
    ),
  readAiSettings: () => Promise.resolve(''),
  writeAiSettings: () => Promise.resolve(),
  writePermissionsSettings: () => Promise.reject(new Error('disk full')),
}))

describe('save() の失敗 (#1099)', () => {
  it('永続状態へ戻し、トーストで知らせる', async () => {
    const { usePermissionsConfig, whenPermissionsReady, resolveForProfiled } =
      await import('./store')
    const { setPermissionPreset } = await import('./schema')
    await whenPermissionsReady()
    const { file, save } = usePermissionsConfig()
    expect(resolveForProfiled('external')['notes.write']).toBe(false)

    // UI で external を full に広げて保存 → 書き込み失敗
    file.value.principals.external = setPermissionPreset(
      file.value.principals.external ?? {
        preset: 'readonly',
        custom: {} as never,
      },
      'full',
    )
    expect(resolveForProfiled('external')['notes.write']).toBe(true)
    save()
    await vi.waitFor(() => {
      expect(toastCalls.some((t) => t.text.includes('保存に失敗'))).toBe(true)
    })
    // メモリ上の変更は捨てられ、ファイルの内容 (readonly) に戻る
    expect(resolveForProfiled('external')['notes.write']).toBe(false)
  })
})

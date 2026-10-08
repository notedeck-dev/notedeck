/**
 * tauri-specta の commands を記録付きで差し替える (Deck*Column の dom テスト用)。
 * vi.mock の factory から import されるので、アプリ側のモジュールを一切 import
 * しない (store → @/bindings → この factory と輪になって固まる)。
 */

export const bindings = {
  /** 呼ばれたコマンドの記録 (mount 前に reset する) */
  calls: [] as { name: string; args: unknown[] }[],
  /** コマンド名ごとの応答。関数なら引数で呼ぶ。未設定は空配列 */
  responses: {} as Record<string, unknown>,
  reset() {
    this.calls = []
    this.responses = {}
  },
  /** 記録から 1 コマンドの呼び出しを探す */
  callsOf(name: string) {
    return this.calls.filter((c) => c.name === name)
  },
}

export function bindingsMock() {
  return {
    commands: new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          (...args: unknown[]) => {
            bindings.calls.push({ name, args })
            const r = bindings.responses[name]
            if (r instanceof Error) return Promise.reject(r)
            const data = typeof r === 'function' ? r(...args) : (r ?? [])
            return Promise.resolve({ status: 'ok', data })
          },
      },
    ),
  }
}

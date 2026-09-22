import { beforeEach, describe, expect, it, vi } from 'vitest'

// tauri-specta bindings: 呼び出しを記録し、一覧だけ差し替え可能にする
const bindings = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
  connections: [] as { id: string; accountScope: string | null }[],
}))
vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        (...args: unknown[]) => {
          bindings.calls.push({ name, args })
          const data =
            name === 'vaultListConnections' ? bindings.connections : null
          return Promise.resolve({ status: 'ok', data })
        },
    },
  ),
}))

import { useVault } from './useVault'

beforeEach(() => {
  bindings.calls.length = 0
  bindings.connections = []
})

describe('useVault.purgeAccount (#1121)', () => {
  it('そのアカウント専用の接続だけを接続ごと削除する', async () => {
    bindings.connections = [
      { id: 'c-mine', accountScope: 'uuid-a' },
      { id: 'c-other', accountScope: 'uuid-b' },
      { id: 'c-global', accountScope: null },
    ]
    await useVault().purgeAccount('uuid-a')
    const deleted = bindings.calls
      .filter((c) => c.name === 'vaultDeleteConnection')
      .map((c) => c.args[0])
    expect(deleted).toEqual(['c-mine'])
  })

  it('該当が無ければ削除も再取得もしない', async () => {
    bindings.connections = [{ id: 'c-global', accountScope: null }]
    await useVault().purgeAccount('uuid-a')
    expect(bindings.calls.map((c) => c.name)).toEqual(['vaultListConnections'])
  })
})

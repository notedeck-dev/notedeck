import { beforeEach, describe, expect, it, vi } from 'vitest'

const emitTauri = vi.fn(
  async (_event: string, _payload: unknown): Promise<void> => undefined,
)
vi.mock('@/utils/tauriEvents', () => ({
  emitTauri: (event: string, payload: unknown) => emitTauri(event, payload),
}))

const invoked: string[] = []
vi.mock('@/utils/tauriInvoke', () => ({
  unwrap: (r: { status: string; data?: unknown }) => r.data,
  commands: {
    writeSettingsFile: async (
      _subdir: string,
      _name: string,
      _content: string,
      _expected: string | null,
    ) => {
      invoked.push('write')
      return { status: 'ok', data: 'v2' }
    },
    deleteSettingsFile: async () => {
      invoked.push('delete')
      return { status: 'ok', data: null }
    },
    renameSettingsFile: async () => {
      invoked.push('rename')
      return { status: 'ok', data: null }
    },
  },
}))

// isTauri は window の印で決まる。import より先 (hoisted) に立てる
vi.hoisted(() => {
  Object.assign(globalThis, { window: { __TAURI_INTERNALS__: {} } })
})

import * as settingsFs from '@/utils/settingsFs'

function announced() {
  return emitTauri.mock.calls.map(
    ([, payload]) => (payload as { change: unknown }).change,
  )
}

describe('settingsFs — デバイス発の書込を他ウィンドウへ知らせる (#1042)', () => {
  beforeEach(() => {
    emitTauri.mockClear()
    invoked.length = 0
  })

  it('write は書けた後に write を 1 件流す (sourceId はこのウィンドウの印)', async () => {
    await settingsFs.writeSettingsFile('widgets', 'a.meta.json5', '{}')
    expect(invoked).toEqual(['write'])
    expect(emitTauri).toHaveBeenCalledTimes(1)
    expect(emitTauri.mock.calls[0]?.[0]).toBe('nd:settings-file-written')
    expect(emitTauri.mock.calls[0]?.[1]).toEqual({
      sourceId: settingsFs.SETTINGS_FS_SOURCE_ID,
      change: { subdir: 'widgets', name: 'a.meta.json5', op: 'write' },
    })
  })

  it('条件付き write も流す', async () => {
    await settingsFs.writeSettingsFileIf('skills', 'x.md', '# x', 'v1')
    expect(announced()).toEqual([
      { subdir: 'skills', name: 'x.md', op: 'write' },
    ])
  })

  it('delete は delete を流す', async () => {
    await settingsFs.deleteSettingsFile('themes', 'old.ndtheme.json5')
    expect(announced()).toEqual([
      { subdir: 'themes', name: 'old.ndtheme.json5', op: 'delete' },
    ])
  })

  it('rename は「新名の write → 旧名の delete」の順で流す (受け手が旧名の個体を消してしまわない順)', async () => {
    await settingsFs.renameSettingsFile('profiles', 'a.x', 'b.x')
    expect(announced()).toEqual([
      { subdir: 'profiles', name: 'b.x', op: 'write' },
      { subdir: 'profiles', name: 'a.x', op: 'delete' },
    ])
  })

  it('emit の失敗は書込の結果に影響しない', async () => {
    emitTauri.mockRejectedValueOnce(new Error('no tauri'))
    await expect(
      settingsFs.writeSettingsFile('widgets', 'a.meta.json5', '{}'),
    ).resolves.toBeUndefined()
  })
})

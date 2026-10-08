import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener[]>()

vi.mock('@/utils/tauriEvents', () => ({
  listenTauri: vi.fn(async (event: string, cb: Listener) => {
    const list = listeners.get(event) ?? []
    list.push(cb)
    listeners.set(event, list)
    return () => undefined
  }),
}))

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  SETTINGS_FS_SOURCE_ID: 'this-window',
}))

import {
  _resetSettingsFileHandlersForTest,
  registerSettingsFileHandler,
} from '@/services/settingsFileSync'
import { startSettingsFileSync } from './useSettingsFileSync'

function fire(event: string, payload: unknown) {
  for (const cb of listeners.get(event) ?? []) cb(payload)
}

describe('startSettingsFileSync', () => {
  // 購読は 1 ウィンドウ 1 回なので、テストでも 1 回だけ始める
  beforeAll(() => startSettingsFileSync())
  afterEach(() => _resetSettingsFileHandlersForTest())

  it('notecore 発の変更 (nd:settings-file-changed) を配線表に配る', async () => {
    const handler = vi.fn()
    registerSettingsFileHandler('widgets', handler)
    fire('nd:settings-file-changed', {
      subdir: 'widgets',
      name: 'a.meta.json5',
      op: 'write',
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
  })

  it('他ウィンドウ発の書込 (nd:settings-file-written) も同じ配線表に配る', async () => {
    const handler = vi.fn()
    registerSettingsFileHandler('profiles', handler)
    fire('nd:settings-file-written', {
      sourceId: 'other-window',
      change: { subdir: 'profiles', name: 'main.ndprofile.json5', op: 'write' },
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      name: 'main.ndprofile.json5',
      op: 'write',
    })
  })

  it('自分のウィンドウ発の書込は配らない (自分の写しは自分で更新している)', async () => {
    const handler = vi.fn()
    registerSettingsFileHandler('profiles', handler)
    fire('nd:settings-file-written', {
      sourceId: 'this-window',
      change: { subdir: 'profiles', name: 'main.ndprofile.json5', op: 'write' },
    })
    await Promise.resolve()
    expect(handler).not.toHaveBeenCalled()
  })
})

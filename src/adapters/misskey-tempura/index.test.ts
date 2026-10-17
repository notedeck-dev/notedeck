import { describe, expect, it, vi } from 'vitest'

const apiGetNoteQuotes = vi.fn()

vi.mock('@/utils/tauriInvoke', () => ({
  commands: {
    apiGetNoteQuotes: (...args: unknown[]) => apiGetNoteQuotes(...args),
  },
  unwrap: (x: unknown) => {
    const r = x as { status: string; data?: unknown; error?: unknown }
    if (r.status === 'error') throw r.error
    return r.data
  },
}))

import { createMisskeyAdapter } from '../misskey'
import type { ServerInfo } from '../types'
import { createMisskeyTempuraAdapter } from './index'

const serverInfo: ServerInfo = {
  host: 'tempura.test',
  software: 'lqvp/misskey-tempura',
  version: '2026.10.0-tempura-2.0.20',
  features: {},
} as unknown as ServerInfo

describe('createMisskeyTempuraAdapter', () => {
  it('引用一覧は tempura の adapter だけが持ち、本家の adapter には無い (#1263)', () => {
    const tempura = createMisskeyTempuraAdapter(serverInfo, 'acc-1', true)
    const misskey = createMisskeyAdapter(serverInfo, 'acc-1', true)
    expect(typeof tempura.api.getNoteQuotes).toBe('function')
    expect(misskey.api.getNoteQuotes).toBeUndefined()
  })

  it('引用一覧を取ると notes/quotes の command にアカウント・ノート・件数・untilId を渡す', async () => {
    const note = { id: 'q1' }
    apiGetNoteQuotes.mockResolvedValue({ status: 'ok', data: [note] })
    const tempura = createMisskeyTempuraAdapter(serverInfo, 'acc-1', true)
    const result = await tempura.api.getNoteQuotes?.('n1', {
      limit: 10,
      untilId: 'u1',
    })
    expect(apiGetNoteQuotes).toHaveBeenCalledWith('acc-1', 'n1', 10, 'u1')
    expect(result).toEqual([note])
  })

  it('件数と untilId を省略すると 30 件・null で呼ぶ', async () => {
    apiGetNoteQuotes.mockResolvedValue({ status: 'ok', data: [] })
    const tempura = createMisskeyTempuraAdapter(serverInfo, 'acc-1', true)
    await tempura.api.getNoteQuotes?.('n1')
    expect(apiGetNoteQuotes).toHaveBeenLastCalledWith('acc-1', 'n1', 30, null)
  })
})

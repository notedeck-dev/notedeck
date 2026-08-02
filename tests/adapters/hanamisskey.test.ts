import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, describe, expect, it } from 'vitest'
import { createHanamisskeyAdapter } from '@/adapters/hanamisskey'
import type { ServerInfo } from '@/adapters/types'
import { AppError } from '@/utils/errors'

const serverInfo: ServerInfo = {
  host: 'misskey.flowers',
  software: 'hanamisskey/misskey',
  version: '2025.11.1-hanami',
  features: {
    mastodonApi: false,
    reactions: true,
    customEmoji: true,
    drive: true,
    channels: true,
    antennas: true,
    quotes: true,
  },
}

describe('createHanamisskeyAdapter', () => {
  afterEach(() => {
    clearMocks()
  })

  it('searchNotes は notes/search ではなく HanamiSearch V1 のコマンドを叩く (#917)', async () => {
    const calls: { cmd: string; args: Record<string, unknown> }[] = []
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: args as Record<string, unknown> })
      return []
    })

    const adapter = createHanamisskeyAdapter(serverInfo, 'acc-1')
    await adapter.api.searchNotes('rust', { untilId: 'n42', limit: 30 })

    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('api_search_notes_hanami')
    expect(calls[0].args).toMatchObject({
      accountId: 'acc-1',
      query: 'rust',
      options: { untilId: 'n42', limit: 30 },
    })
  })

  it('ゲスト (トークンなし) の検索はサーバーに投げる前に弾く', async () => {
    const adapter = createHanamisskeyAdapter(serverInfo, 'acc-1', false)
    await expect(adapter.api.searchNotes('rust')).rejects.toBeInstanceOf(
      AppError,
    )
  })

  it('検索以外は本家アダプターの実装をそのまま使う', async () => {
    const calls: string[] = []
    mockIPC((cmd) => {
      calls.push(cmd)
      return []
    })

    const adapter = createHanamisskeyAdapter(serverInfo, 'acc-1')
    await adapter.api.getTimeline('home', { limit: 20 })

    expect(calls).toEqual(['api_get_timeline'])
  })
})

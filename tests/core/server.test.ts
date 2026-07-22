import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectionToServerInfo, detectServer } from '@/core/server'

// nodeinfo/meta の取得と SWR キャッシュは notecli 側に移設済み (#782)。
// ここでは「ServerDetection → ServerInfo の解決」(フォーク判定 + feature +
// meta URL 解決) を検証する。
vi.mock('@/utils/tauriInvoke', () => ({
  commands: {
    detectServer: vi.fn(),
  },
  unwrap: (result: { status: string; data?: unknown; error?: unknown }) => {
    if (result.status === 'ok') return result.data
    throw result.error
  },
}))

import { commands } from '@/utils/tauriInvoke'

function detection(softwareName: string, overrides = {}) {
  return {
    host: 'example.com',
    softwareName,
    softwareVersion: '2025.1.0',
    softwareRepository: null,
    metaJson: '{}',
    updatedAt: 1700000000000,
    ...overrides,
  }
}

describe('server detection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockDetect(softwareName: string) {
    vi.mocked(commands.detectServer).mockResolvedValue({
      status: 'ok',
      data: detection(softwareName),
    } as never)
  }

  it('detects misskey server', async () => {
    mockDetect('misskey')
    const info = await detectServer('example.com')

    expect(info.host).toBe('example.com')
    expect(info.software).toBe('misskey-dev/misskey')
    expect(info.version).toBe('2025.1.0')
    expect(info.features.reactions).toBe(true)
  })

  it('detects yamisskey server', async () => {
    mockDetect('yamisskey')
    const info = await detectServer('yami.ski')

    expect(info.software).toBe('yamisskey-dev/yamisskey')
  })

  it('detects misskey-tepura server', async () => {
    mockDetect('misskey-tepura')
    const info = await detectServer('misskey.vip')

    expect(info.software).toBe('lqvp/misskey-tepura')
  })

  it('returns unknown for non-misskey software', async () => {
    mockDetect('mastodon')
    const info = await detectServer('masto.example.com')

    expect(info.software).toBe('unknown')
  })

  it('throws when detection fails (nodeinfo unreachable)', async () => {
    vi.mocked(commands.detectServer).mockResolvedValue({
      status: 'error',
      error: { code: 'NETWORK', message: 'No nodeinfo URL found' },
    } as never)

    await expect(detectServer('bad.example.com')).rejects.toMatchObject({
      message: 'No nodeinfo URL found',
    })
  })
})

describe('detectionToServerInfo', () => {
  it('repository URL があれば name より優先してフォーク解決する', () => {
    const info = detectionToServerInfo(
      detection('misskey', {
        softwareRepository: 'https://github.com/yamisskey-dev/yamisskey',
      }),
    )
    expect(info.software).toBe('yamisskey-dev/yamisskey')
  })

  it('meta の相対 URL を host 起点で絶対化し、絶対 URL はそのまま通す', () => {
    const info = detectionToServerInfo(
      detection('misskey', {
        metaJson: JSON.stringify({
          iconUrl: '/icon.png',
          infoImageUrl: 'https://cdn.example/info.png',
        }),
      }),
    )
    expect(info.iconUrl).toBe('https://example.com/icon.png')
    expect(info.infoImageUrl).toBe('https://cdn.example/info.png')
  })

  it('meta が空/壊れている場合は favicon フォールバック', () => {
    const broken = detectionToServerInfo(
      detection('misskey', { metaJson: '{{{ broken' }),
    )
    expect(broken.iconUrl).toBe('https://example.com/favicon.ico')
    expect(broken.themeColor).toBeNull()
  })
})

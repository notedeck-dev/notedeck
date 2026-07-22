import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useServersStore } from '@/stores/servers'

// SWR (TTL / dedup / 背景再検出) は notecli 側に移設済み (#782)。
// ここでは「Rust から返る ServerDetection → ServerInfo の解決 + メモリキャッシュ」
// を実物の detectionToServerInfo ごと検証する。
vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      getServerDetection: vi.fn(async () => ({
        status: 'ok',
        data: createMockDetection(),
      })),
      loadServerDetections: vi.fn(async () => ({ status: 'ok', data: [] })),
      detectServer: vi.fn(),
    },
  }
})

import { commands } from '@/utils/tauriInvoke'

function createMockDetection(host = 'example.com') {
  return {
    host,
    softwareName: 'misskey',
    softwareVersion: '2025.1.0',
    softwareRepository: 'https://github.com/misskey-dev/misskey',
    metaJson: JSON.stringify({
      iconUrl: '/icon.png',
      themeColor: '#86b300',
      infoImageUrl: '/info.png',
    }),
    updatedAt: 1700000000000,
  }
}

describe('servers store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('検出結果を ServerInfo に解決してキャッシュする', async () => {
    const store = useServersStore()

    const info = await store.getServerInfo('example.com')

    expect(info.host).toBe('example.com')
    expect(info.software).toBe('misskey-dev/misskey')
    expect(info.version).toBe('2025.1.0')
    // 相対 URL は host 起点で絶対化される
    expect(info.iconUrl).toBe('https://example.com/icon.png')
    expect(info.infoImageUrl).toBe('https://example.com/info.png')
    expect(info.themeColor).toBe('#86b300')
    // features は読取時に software から解決される
    expect(info.features.scheduledNotes).toBe(true)
    expect(commands.getServerDetection).toHaveBeenCalledWith('example.com')
  })

  it('2 回目はメモリキャッシュから返し IPC を呼ばない', async () => {
    const store = useServersStore()

    await store.getServerInfo('example.com')
    const info = await store.getServerInfo('example.com')

    expect(info.software).toBe('misskey-dev/misskey')
    expect(commands.getServerDetection).toHaveBeenCalledTimes(1)
  })

  it('meta 取得失敗 ("{}") は favicon フォールバックで解決する', async () => {
    vi.mocked(commands.getServerDetection).mockResolvedValueOnce({
      status: 'ok',
      data: { ...createMockDetection(), metaJson: '{}' },
      // biome-ignore lint/suspicious/noExplicitAny: bindings Result 型のモック
    } as any)
    const store = useServersStore()

    const info = await store.getServerInfo('example.com')

    expect(info.iconUrl).toBe('https://example.com/favicon.ico')
    expect(info.themeColor).toBeNull()
    expect(info.infoImageUrl).toBeUndefined()
  })

  it('loadCachedServers は DB 全件をメモリへ展開する', async () => {
    vi.mocked(commands.loadServerDetections).mockResolvedValueOnce({
      status: 'ok',
      data: [
        createMockDetection('a.example'),
        createMockDetection('b.example'),
      ],
      // biome-ignore lint/suspicious/noExplicitAny: bindings Result 型のモック
    } as any)
    const store = useServersStore()

    await store.loadCachedServers()

    expect(store.getServer('a.example')?.software).toBe('misskey-dev/misskey')
    expect(store.getServer('b.example')).toBeTruthy()
    expect(commands.getServerDetection).not.toHaveBeenCalled()
  })

  it('未知の host は getServer で undefined を返す', () => {
    const store = useServersStore()
    expect(store.getServer('unknown.com')).toBeUndefined()
  })
})

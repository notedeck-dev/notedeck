// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _clearCapabilitiesForTest,
  registerCapability,
} from '@/capabilities/registry'
import type { Command } from '@/commands/registry'
import { handleQuery } from '@/core/apiBridge'
import { recordStreamHealth } from '@/core/streamHealth'
import type { ProfiledPrincipalId } from '@/permissions/principal'
import {
  EXTERNAL_READ_FLOOR,
  PERMISSION_KEYS,
  setPermissionPreset,
} from '@/permissions/schema'
import {
  _resetPermissionsForTest,
  usePermissionsConfig,
} from '@/permissions/store'
import { createBoundedCache } from '@/services/boundedCache'
import { useStreamInspectorStore } from '@/stores/streamInspector'
import { markStartup } from '@/utils/startupTrace'

function makeCapability(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.cap',
    label: 'test',
    icon: 'ti-flask',
    category: 'general',
    shortcuts: [],
    aiTool: true,
    permissions: [],
    signature: { description: 'test capability' },
    execute: () => 'ok',
    ...overrides,
  }
}

function setPrincipalPreset(
  id: ProfiledPrincipalId,
  preset: 'readonly' | 'safe' | 'full',
): void {
  const { file } = usePermissionsConfig()
  file.value.principals[id] = setPermissionPreset(
    file.value.principals[id] ?? { preset: 'readonly', custom: {} as never },
    preset,
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
  _resetPermissionsForTest()
})

afterEach(() => {
  _clearCapabilitiesForTest()
})

describe('handleQuery: capabilities/list', () => {
  it('registry の capability をシグネチャ付きで返す', async () => {
    registerCapability(
      makeCapability({
        id: 'memos.search',
        label: 'メモ検索',
        permissions: ['memos.read'],
        signature: {
          description: 'search memos',
          params: {
            query: { type: 'string', description: 'search query' },
          },
          returns: { type: 'array' },
        },
      }),
    )
    const result = (await handleQuery('capabilities/list', {})) as Array<
      Record<string, unknown>
    >
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'memos.search',
      name: 'memos_search',
      label: 'メモ検索',
      description: 'search memos',
      permissions: ['memos.read'],
      requiresConfirmation: false,
    })
    expect(result[0].params).toHaveProperty('query')
  })

  it('requiresConfirmation は関数でも boolean true に落とす', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.delete',
        requiresConfirmation: () => null,
      }),
    )
    const result = (await handleQuery('capabilities/list', {})) as Array<
      Record<string, unknown>
    >
    expect(result[0].requiresConfirmation).toBe(true)
  })
})

describe('handleQuery: capabilities/execute', () => {
  it('external プロファイル (default 縮小 custom) で write 系を deny する', async () => {
    registerCapability(
      makeCapability({ id: 'notes.create', permissions: ['notes.write'] }),
    )
    const result = (await handleQuery('capabilities/execute', {
      capabilityId: 'notes.create',
    })) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('permission_denied')
  })

  it('chat 側を full にしても external 側が絞られていれば deny (独立性)', async () => {
    registerCapability(
      makeCapability({ id: 'notes.create', permissions: ['notes.write'] }),
    )
    setPrincipalPreset('ai.chat', 'full')
    const result = (await handleQuery('capabilities/execute', {
      capabilityId: 'notes.create',
    })) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('permission_denied')
  })

  it('external プロファイルを full にすれば write 系も実行され result が返る', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        execute: (params) => ({ id: 'note1', text: params?.text }),
      }),
    )
    setPrincipalPreset('external', 'full')
    const result = (await handleQuery('capabilities/execute', {
      capabilityId: 'notes.create',
      params: { text: 'hello' },
    })) as { ok: boolean; result?: unknown }
    expect(result.ok).toBe(true)
    expect(result.result).toEqual({ id: 'note1', text: 'hello' })
  })

  it('未登録 capability は unknown_capability を返す', async () => {
    const result = (await handleQuery('capabilities/execute', {
      capabilityId: 'no.such.cap',
    })) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('unknown_capability')
  })
})

describe('handleQuery: health/streams', () => {
  it('記録済みのストリーム状態を accountId 付きで返す', async () => {
    recordStreamHealth('acc1', 'connected')
    const result = (await handleQuery('health/streams', {})) as Array<{
      accountId: string
      state: string
      since: number
    }>
    const acc1 = result.find((r) => r.accountId === 'acc1')
    expect(acc1?.state).toBe('connected')
    expect(acc1?.since).toBeGreaterThan(0)
  })
})

describe('handleQuery: startup/trace (#977)', () => {
  it('記録済みの起動マークを entries として返す', async () => {
    markStartup('test-mark')
    const result = (await handleQuery('startup/trace', {})) as {
      entries: { name: string; at: number }[]
      webviewFixedCost: number | null
    }
    const mark = result.entries.find((e) => e.name === 'test-mark')
    expect(mark?.at).toBeGreaterThan(0)
    // happy-dom には navigation entry が無いので null (実機では数値)
    expect(
      result.webviewFixedCost === null ||
        typeof result.webviewFixedCost === 'number',
    ).toBe(true)
  })
})

describe('handleQuery: permissions/resolved (#977)', () => {
  it('4 principal の granted map と全 permission キーを返す', async () => {
    const result = (await handleQuery('permissions/resolved', {})) as {
      keys: string[]
      principals: Record<string, Record<string, boolean>>
    }
    expect(result.keys).toEqual([...PERMISSION_KEYS])
    for (const id of ['ai.chat', 'ai.heartbeat', 'plugin', 'external']) {
      const map = result.principals[id]
      expect(map, id).toBeDefined()
      for (const key of PERMISSION_KEYS) {
        expect(typeof map?.[key], `${id}.${key}`).toBe('boolean')
      }
    }
  })

  it('external の既定は READ_FLOOR のみ true で write 系は false', async () => {
    const result = (await handleQuery('permissions/resolved', {})) as {
      principals: Record<string, Record<string, boolean>>
    }
    const external = result.principals.external
    for (const key of EXTERNAL_READ_FLOOR) {
      expect(external?.[key], key).toBe(true)
    }
    expect(external?.['notes.write']).toBe(false)
  })

  it('preset 変更が解決結果に反映される', async () => {
    setPrincipalPreset('external', 'full')
    const result = (await handleQuery('permissions/resolved', {})) as {
      principals: Record<string, Record<string, boolean>>
    }
    expect(result.principals.external?.['notes.write']).toBe(true)
  })
})

describe('handleQuery: heartbeat/status (#977)', () => {
  it('daemon スナップショットと config を返す (テスト環境では未 mount)', async () => {
    const result = (await handleQuery('heartbeat/status', {})) as {
      mounted: boolean
      running: boolean
      consecutiveFailures: number
      config: { enabled: boolean; intervalMinutes: number; target: string }
    }
    expect(result.mounted).toBe(false)
    expect(result.running).toBe(false)
    expect(typeof result.consecutiveFailures).toBe('number')
    expect(typeof result.config.enabled).toBe('boolean')
    expect(typeof result.config.intervalMinutes).toBe('number')
    expect(typeof result.config.target).toBe('string')
  })
})

describe('handleQuery: perf/caches (#977/#987)', () => {
  it('名前付き boundedCache の size/limit を返す', async () => {
    const cache = createBoundedCache<string, number>(7, 'test:api-bridge')
    cache.set('x', 1)
    const result = (await handleQuery('perf/caches', {})) as Array<{
      name: string
      size: number
      limit: number
    }>
    const stat = result.find((s) => s.name === 'test:api-bridge')
    expect(stat).toEqual({ name: 'test:api-bridge', size: 1, limit: 7 })
  })
})

describe('handleQuery: inspector/recent (#977)', () => {
  it('アダプタ層バッファを kind 別カウントに集計する', async () => {
    const inspector = useStreamInspectorStore()
    const badge = { avatar: null, serverIcon: null }
    inspector.buffer = [
      {
        id: 1,
        ts: 100,
        kind: 'stream-note',
        accountId: 'a',
        observer: badge,
        subject: null,
        payload: {},
      },
      {
        id: 2,
        ts: 50,
        kind: 'stream-note',
        accountId: 'a',
        observer: badge,
        subject: null,
        payload: {},
      },
      {
        id: 3,
        ts: 10,
        kind: 'stream-notification',
        accountId: 'a',
        observer: badge,
        subject: null,
        payload: {},
      },
    ]
    const result = (await handleQuery('inspector/recent', {})) as {
      total: number
      counts: Record<string, number>
      oldestTs: number | null
    }
    expect(result.total).toBe(3)
    expect(result.counts).toEqual({
      'stream-note': 2,
      'stream-notification': 1,
    })
    expect(result.oldestTs).toBe(10)
  })
})

describe('handleQuery: 共通挙動', () => {
  it('未知の query type は error envelope を返す', async () => {
    const result = (await handleQuery('nope/nothing', {})) as {
      error?: string
    }
    expect(result.error).toContain('nope/nothing')
  })
})

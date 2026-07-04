// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _clearCapabilitiesForTest,
  registerCapability,
} from '@/capabilities/registry'
import type { Command } from '@/commands/registry'
import {
  _resetAiConfigForTest,
  setPermissionPreset,
  useAiConfig,
} from '@/composables/useAiConfig'
import { handleQuery } from '@/core/apiBridge'

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

beforeEach(() => {
  setActivePinia(createPinia())
  _resetAiConfigForTest()
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
  it('httpApi permissions (default readonly) で write 系を deny する', async () => {
    registerCapability(
      makeCapability({ id: 'notes.create', permissions: ['notes.write'] }),
    )
    const result = (await handleQuery('capabilities/execute', {
      capabilityId: 'notes.create',
    })) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('permission_denied')
  })

  it('chat 側の permissions を full にしても httpApi 側が readonly なら deny (独立性)', async () => {
    registerCapability(
      makeCapability({ id: 'notes.create', permissions: ['notes.write'] }),
    )
    const { config } = useAiConfig()
    config.value.permissions = setPermissionPreset(
      config.value.permissions,
      'full',
    )
    const result = (await handleQuery('capabilities/execute', {
      capabilityId: 'notes.create',
    })) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('permission_denied')
  })

  it('httpApi permissions を full にすれば write 系も実行され result が返る', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        execute: (params) => ({ id: 'note1', text: params?.text }),
      }),
    )
    const { config } = useAiConfig()
    config.value.httpApi.permissions = setPermissionPreset(
      config.value.httpApi.permissions,
      'full',
    )
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

describe('handleQuery: 共通挙動', () => {
  it('未知の query type は error envelope を返す', async () => {
    const result = (await handleQuery('nope/nothing', {})) as {
      error?: string
    }
    expect(result.error).toContain('nope/nothing')
  })
})

// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Capability } from '@/capabilities/types'
import {
  _clearPluginDenialsForTest,
  getPluginDenial,
} from '@/permissions/pluginDenials'
import { setPermissionPreset } from '@/permissions/schema'
import {
  _resetPermissionsForTest,
  usePermissionsConfig,
} from '@/permissions/store'
import { useAiScriptLogsStore } from '@/stores/aiscriptLogs'
import { dispatchCapability } from './dispatcher'
import type { LoopbackGateResult } from './loopbackGate'
import { _clearCapabilitiesForTest, registerCapability } from './registry'

const gate = vi.hoisted(() => ({
  result: { kind: 'pass', port: null } as LoopbackGateResult,
  calls: 0,
}))

vi.mock('./loopbackGate', async () => {
  const actual =
    await vi.importActual<typeof import('./loopbackGate')>('./loopbackGate')
  return {
    ...actual,
    gateLoopbackFetch: async () => {
      gate.calls += 1
      return gate.result
    },
  }
})

function httpFetch(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'http.fetch',
    label: 'http',
    icon: 'ti-world',
    category: 'general',
    aiTool: true,
    permissions: ['network.external'],
    signature: { description: 'fetch' },
    requiresConfirmation: true,
    execute: () => ({ status: 200, headers: {}, body: 'ok' }),
    ...overrides,
  }
}

const plugin = { kind: 'plugin', pluginId: 'p1', name: 'Alpha' } as const
const url = 'http://localhost:8080/x'

beforeEach(() => {
  setActivePinia(createPinia())
  const { file } = usePermissionsConfig()
  file.value.principals.plugin = setPermissionPreset(
    file.value.principals.plugin ?? { preset: 'readonly', custom: {} as never },
    'full',
  )
  gate.calls = 0
  gate.result = { kind: 'pass', port: null }
})

afterEach(() => {
  _clearCapabilitiesForTest()
  _resetPermissionsForTest()
  _clearPluginDenialsForTest()
})

describe('dispatcher × loopback (#1293)', () => {
  it('plugin の http.fetch だけゲートを通す', async () => {
    registerCapability(httpFetch())
    await dispatchCapability(
      'http.fetch',
      { url: 'https://example.com/' },
      { principal: { kind: 'ai.chat' } },
      { confirmFn: async () => ({ accepted: true, remember: false }) },
    )
    expect(gate.calls).toBe(0)
    await dispatchCapability(
      'http.fetch',
      { url: 'https://example.com/' },
      { principal: plugin },
      { confirmFn: async () => ({ accepted: true, remember: false }) },
    )
    expect(gate.calls).toBe(1)
  })

  it('拒否は permission_denied で、理由つきのバッジと運用ログに残る', async () => {
    registerCapability(httpFetch({ execute: () => 'must not run' }))
    gate.result = { kind: 'denied', port: 8080, reason: 'undeclared' }
    const r = await dispatchCapability(
      'http.fetch',
      { url },
      { principal: plugin, origin: 'other' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('permission_denied')
    expect(getPluginDenial('p1')).toMatchObject({
      lastTarget: 'http.fetch',
      reason: 'undeclared',
      count: 1,
    })
    const logs = useAiScriptLogsStore().entriesFor('plugin', 'p1')
    expect(logs.at(-1)?.message).toBe('loopback GET /x -> denied: undeclared')
  })

  it('同意ダイアログで承認された要求は従来の確認を出さずに実行する', async () => {
    registerCapability(httpFetch())
    gate.result = { kind: 'consented', port: 8080 }
    const confirmFn = vi.fn(async () => ({ accepted: true, remember: false }))
    const r = await dispatchCapability(
      'http.fetch',
      { url },
      { principal: plugin, origin: 'ui' },
      { confirmFn },
    )
    expect(r.ok).toBe(true)
    expect(confirmFn).not.toHaveBeenCalled()
    const logs = useAiScriptLogsStore().entriesFor('plugin', 'p1')
    expect(logs.at(-1)?.message).toBe('loopback GET /x -> status 200')
  })

  it('同意済み (pass) の要求は従来の http.fetch の確認を通る', async () => {
    registerCapability(httpFetch())
    gate.result = { kind: 'pass', port: 8080 }
    const confirmFn = vi.fn(async () => ({ accepted: true, remember: false }))
    const r = await dispatchCapability(
      'http.fetch',
      { url },
      { principal: plugin, origin: 'ui' },
      { confirmFn },
    )
    expect(r.ok).toBe(true)
    expect(confirmFn).toHaveBeenCalledTimes(1)
  })

  it('Rust が LOOPBACK_* の code で拒んだら execute_failed のままバッジに写す', async () => {
    registerCapability(
      httpFetch({
        execute: () => {
          throw Object.assign(new Error('stale'), { code: 'LOOPBACK_STALE' })
        },
      }),
    )
    gate.result = { kind: 'pass', port: 8080 }
    const r = await dispatchCapability(
      'http.fetch',
      { url },
      { principal: plugin, origin: 'other' },
      { confirmFn: async () => ({ accepted: true, remember: false }) },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('execute_failed')
    expect(getPluginDenial('p1')?.reason).toBe('stale')
  })
})

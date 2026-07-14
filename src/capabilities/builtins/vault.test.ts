import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@/bindings'
import type { CapabilityContext } from '@/capabilities/types'

// `commands.*` をモックして実 Tauri invoke を回避する。`unwrap` は実物を使う
// (ok-Result をそのまま剥がすだけ)。接続一覧はテストごとに差し替える。
const listConnections = vi.fn()
const setTrusted = vi.fn(
  async (_id: string, _cls: string, _trusted: boolean) => ({
    status: 'ok',
    data: null,
  }),
)

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      vaultListConnections: () => listConnections(),
      vaultSetTrusted: (id: string, cls: string, trusted: boolean) =>
        setTrusted(id, cls, trusted),
      vaultFetch: vi.fn(async () => ({ status: 'ok', data: {} })),
    },
  }
})

import { vaultFetchCapability } from './vault'

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-habitica',
    name: 'Habitica',
    baseUrl: 'https://habitica.com/api/v3',
    authType: { kind: 'bearer' },
    exposedTo: ['ai'],
    trustedFor: [],
    slots: ['primary'],
    createdAt: '0',
    updatedAt: '0',
    ...overrides,
  }
}

function setConnections(conns: Connection[]) {
  listConnections.mockResolvedValue({ status: 'ok', data: conns })
}

const AI_CTX: CapabilityContext = { principal: { kind: 'ai.chat' } }
const EXTERNAL_CTX: CapabilityContext = { principal: { kind: 'external' } }
const PLUGIN_CTX: CapabilityContext = {
  principal: { kind: 'plugin', pluginId: 'widget:habitica-status' },
}

/** vaultFetchCapability.requiresConfirmation は関数形。型を絞って呼ぶ。 */
const requiresConfirmation = vaultFetchCapability.requiresConfirmation as (
  params: Record<string, unknown> | undefined,
  ctx: CapabilityContext,
) => Promise<import('@/stores/confirm').ConfirmOptions | null>

beforeEach(() => {
  listConnections.mockReset()
  setTrusted.mockClear()
})

describe('vaultFetchCapability.requiresConfirmation (per-class #712 §6.2)', () => {
  it('Ai クラスで信頼済みの接続は ai.chat から確認スキップ', async () => {
    setConnections([makeConnection({ trustedFor: ['ai'] })])
    const result = await requiresConfirmation(
      { connectionRef: 'Habitica' },
      AI_CTX,
    )
    expect(result).toBeNull()
  })

  it('Ai クラスの trust は external には効かない (同意のクラス分離)', async () => {
    setConnections([
      makeConnection({ exposedTo: ['ai', 'external'], trustedFor: ['ai'] }),
    ])
    const result = await requiresConfirmation(
      { connectionRef: 'Habitica' },
      EXTERNAL_CTX,
    )
    expect(result).not.toBeNull()
  })

  it('未信頼の接続には rememberLabel 付き ConfirmOptions を返す', async () => {
    setConnections([makeConnection()])
    const result = await requiresConfirmation(
      { connectionRef: 'Habitica' },
      AI_CTX,
    )
    expect(result).not.toBeNull()
    expect(result?.rememberLabel).toBeTruthy()
    expect(result?.message).toContain('Habitica')
  })

  it('resolves connectionRef case-insensitively by name', async () => {
    setConnections([makeConnection({ trustedFor: ['ai'] })])
    const result = await requiresConfirmation(
      { connectionRef: 'habitica' },
      AI_CTX,
    )
    expect(result).toBeNull()
  })

  it('omits rememberLabel when connectionRef does not resolve', async () => {
    setConnections([makeConnection()])
    const result = await requiresConfirmation(
      { connectionRef: 'Unknown' },
      AI_CTX,
    )
    expect(result).not.toBeNull()
    expect(result?.rememberLabel).toBeUndefined()
  })

  it('Ai に開示されていない接続は trust があっても確認が出る (master gate)', async () => {
    setConnections([makeConnection({ exposedTo: [], trustedFor: ['ai'] })])
    const result = await requiresConfirmation(
      { connectionRef: 'Habitica' },
      AI_CTX,
    )
    expect(result).not.toBeNull()
    expect(result?.rememberLabel).toBeUndefined()
  })

  it('Plugin クラスで信頼済みの接続は plugin principal から確認スキップ (#759)', async () => {
    setConnections([
      makeConnection({ exposedTo: ['plugin'], trustedFor: ['plugin'] }),
    ])
    const result = await requiresConfirmation(
      { connectionRef: 'Habitica' },
      PLUGIN_CTX,
    )
    expect(result).toBeNull()
  })

  it('plugin の rememberLabel は同意の及ぶ範囲 (全プラグイン) を明示する (#759)', async () => {
    setConnections([makeConnection({ exposedTo: ['plugin'] })])
    const result = await requiresConfirmation(
      { connectionRef: 'Habitica' },
      PLUGIN_CTX,
    )
    expect(result?.rememberLabel).toContain('すべてのプラグイン')
  })

  it('Ai クラスの trust は plugin には効かない (同意のクラス分離)', async () => {
    setConnections([
      makeConnection({ exposedTo: ['ai', 'plugin'], trustedFor: ['ai'] }),
    ])
    const result = await requiresConfirmation(
      { connectionRef: 'Habitica' },
      PLUGIN_CTX,
    )
    expect(result).not.toBeNull()
  })
})

describe('vaultFetchCapability.onConfirmRemember', () => {
  it('昇格は呼び出しクラスだけに効く (ai.chat → Ai クラス)', async () => {
    setConnections([makeConnection({ id: 'conn-habitica' })])
    await vaultFetchCapability.onConfirmRemember?.(
      { connectionRef: 'Habitica' },
      AI_CTX,
    )
    expect(setTrusted).toHaveBeenCalledWith('conn-habitica', 'ai', true)
  })

  it('external の同意は External クラスにだけ効く (Ai に化けない)', async () => {
    setConnections([
      makeConnection({ id: 'conn-habitica', exposedTo: ['external'] }),
    ])
    await vaultFetchCapability.onConfirmRemember?.(
      { connectionRef: 'Habitica' },
      EXTERNAL_CTX,
    )
    expect(setTrusted).toHaveBeenCalledWith('conn-habitica', 'external', true)
  })

  it('plugin の同意は Plugin クラスにだけ効く (#759)', async () => {
    setConnections([
      makeConnection({ id: 'conn-habitica', exposedTo: ['plugin'] }),
    ])
    await vaultFetchCapability.onConfirmRemember?.(
      { connectionRef: 'Habitica' },
      PLUGIN_CTX,
    )
    expect(setTrusted).toHaveBeenCalledWith('conn-habitica', 'plugin', true)
  })

  it('does nothing when connectionRef does not resolve', async () => {
    setConnections([makeConnection()])
    await vaultFetchCapability.onConfirmRemember?.(
      { connectionRef: 'Unknown' },
      AI_CTX,
    )
    expect(setTrusted).not.toHaveBeenCalled()
  })
})

describe('vaultFetchCapability.execute — 開示クラスのフィルタ (#712 §6.1)', () => {
  it('external principal は External 開示の無い接続に到達できない', async () => {
    setConnections([makeConnection({ exposedTo: ['ai'] })])
    await expect(
      vaultFetchCapability.execute(
        { connectionRef: 'Habitica', path: '/status' },
        EXTERNAL_CTX,
      ),
    ).rejects.toThrow(/利用できません/)
  })

  it('plugin principal は Plugin 開示の無い接続に到達できない (default 非開示 #759)', async () => {
    setConnections([makeConnection({ exposedTo: ['ai', 'external'] })])
    await expect(
      vaultFetchCapability.execute(
        { connectionRef: 'Habitica', path: '/status' },
        PLUGIN_CTX,
      ),
    ).rejects.toThrow(/利用できません/)
  })

  it('Plugin 開示 opt-in された接続は plugin principal から解決できる (#759)', async () => {
    setConnections([makeConnection({ exposedTo: ['plugin'] })])
    await expect(
      vaultFetchCapability.execute(
        { connectionRef: 'Habitica', path: '/status' },
        PLUGIN_CTX,
      ),
    ).resolves.toBeDefined()
  })

  it('user principal は開示に関わらず全接続を扱える (本人操作)', async () => {
    setConnections([makeConnection({ exposedTo: [] })])
    await expect(
      vaultFetchCapability.execute(
        { connectionRef: 'Habitica', path: '/status' },
        { principal: { kind: 'user' } },
      ),
    ).resolves.toBeDefined()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '@/bindings'

// `commands.*` をモックして実 Tauri invoke を回避する。`unwrap` は実物を使う
// (ok-Result をそのまま剥がすだけ)。接続一覧はテストごとに差し替える。
const listConnections = vi.fn()
const setAiTrusted = vi.fn(async (_id: string, _trusted: boolean) => ({
  status: 'ok',
  data: null,
}))

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      vaultListConnections: () => listConnections(),
      vaultSetAiTrusted: (id: string, trusted: boolean) =>
        setAiTrusted(id, trusted),
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
    aiVisible: true,
    aiTrusted: false,
    slots: ['primary'],
    createdAt: '0',
    updatedAt: '0',
    ...overrides,
  }
}

function setConnections(conns: Connection[]) {
  listConnections.mockResolvedValue({ status: 'ok', data: conns })
}

/** vaultFetchCapability.requiresConfirmation は関数形。型を絞って呼ぶ。 */
const requiresConfirmation = vaultFetchCapability.requiresConfirmation as (
  params: Record<string, unknown> | undefined,
) => Promise<import('@/stores/confirm').ConfirmOptions | null>

beforeEach(() => {
  listConnections.mockReset()
  setAiTrusted.mockClear()
})

describe('vaultFetchCapability.requiresConfirmation', () => {
  it('returns null (= 確認スキップ) for an aiTrusted connection', async () => {
    setConnections([makeConnection({ aiTrusted: true })])
    const result = await requiresConfirmation({ connectionRef: 'Habitica' })
    expect(result).toBeNull()
  })

  it('returns ConfirmOptions with rememberLabel for an untrusted connection', async () => {
    setConnections([makeConnection({ aiTrusted: false })])
    const result = await requiresConfirmation({ connectionRef: 'Habitica' })
    expect(result).not.toBeNull()
    expect(result?.rememberLabel).toBeTruthy()
    expect(result?.message).toContain('Habitica')
  })

  it('resolves connectionRef case-insensitively by name', async () => {
    setConnections([makeConnection({ aiTrusted: true })])
    const result = await requiresConfirmation({ connectionRef: 'habitica' })
    expect(result).toBeNull()
  })

  it('omits rememberLabel when connectionRef does not resolve', async () => {
    setConnections([makeConnection()])
    const result = await requiresConfirmation({ connectionRef: 'Unknown' })
    expect(result).not.toBeNull()
    expect(result?.rememberLabel).toBeUndefined()
  })

  it('does NOT skip confirmation for an aiTrusted-but-not-aiVisible connection', async () => {
    // aiVisible: false は resolveVisibleConnection で除外される =
    // aiTrusted が true でも信頼チェックに到達せず、確認が出る (master gate)。
    setConnections([makeConnection({ aiVisible: false, aiTrusted: true })])
    const result = await requiresConfirmation({ connectionRef: 'Habitica' })
    expect(result).not.toBeNull()
    expect(result?.rememberLabel).toBeUndefined()
  })
})

describe('vaultFetchCapability.onConfirmRemember', () => {
  it('promotes the resolved connection to aiTrusted via vaultSetAiTrusted', async () => {
    setConnections([makeConnection({ id: 'conn-habitica' })])
    await vaultFetchCapability.onConfirmRemember?.({
      connectionRef: 'Habitica',
    })
    expect(setAiTrusted).toHaveBeenCalledWith('conn-habitica', true)
  })

  it('does nothing when connectionRef does not resolve', async () => {
    setConnections([makeConnection()])
    await vaultFetchCapability.onConfirmRemember?.({ connectionRef: 'Unknown' })
    expect(setAiTrusted).not.toHaveBeenCalled()
  })
})

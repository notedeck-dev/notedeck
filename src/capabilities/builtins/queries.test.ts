// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityContext } from '@/capabilities/types'
import { useColumnQueriesStore } from '@/stores/columnQueries'

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: false }
})

const history = vi.hoisted(() => ({
  entries: [] as { at: number; snapshot: { src: string; name?: string } }[],
}))
vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
  listSnapshots: vi.fn(async () => history.entries),
  getSnapshotAt: vi.fn(
    async (_k: string, _b: string, i: number) => history.entries[i] ?? null,
  ),
}))

import {
  QUERIES_BUILTIN_CAPABILITIES,
  queriesHistoryCapability,
  queriesRevertCapability,
} from './queries'

const ctx = { principal: { kind: 'user' } } as unknown as CapabilityContext

describe('queries capabilities (#1117)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    history.entries = []
  })

  it('history / revert の 2 つを公開し、権限キーは queries.*', () => {
    expect(QUERIES_BUILTIN_CAPABILITIES.map((c) => c.id).sort()).toEqual([
      'queries.history',
      'queries.revert',
    ])
    expect(queriesHistoryCapability.permissions).toEqual(['queries.read'])
    expect(queriesRevertCapability.permissions).toEqual(['queries.write'])
  })

  it('revert は snapshot の src に戻す', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'now' })
    history.entries = [{ at: 1, snapshot: { src: 'before', name: 'a' } }]
    const result = await queriesRevertCapability.execute(
      { id: q.id, index: 0 },
      ctx,
    )
    expect(result).toMatchObject({ id: q.id, reverted: true, at: 1 })
    expect(store.getQuery(q.id)?.src).toBe('before')
  })

  it('history は snapshot 一覧を返す', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'now' })
    history.entries = [{ at: 1, snapshot: { src: 'before' } }]
    const result = await queriesHistoryCapability.execute({ id: q.id }, ctx)
    expect(result).toEqual(history.entries)
  })
})

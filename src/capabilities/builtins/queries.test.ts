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
  queriesCreateCapability,
  queriesDeleteCapability,
  queriesHistoryCapability,
  queriesListCapability,
  queriesReadCapability,
  queriesRevertCapability,
  queriesUpdateCapability,
} from './queries'

const ctx = { principal: { kind: 'user' } } as unknown as CapabilityContext

describe('queries capabilities (#1117 / #1233)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    history.entries = []
  })

  it('list / read / create / update / delete / history / revert を公開し、権限キーは queries.*', () => {
    expect(QUERIES_BUILTIN_CAPABILITIES.map((c) => c.id).sort()).toEqual([
      'queries.create',
      'queries.delete',
      'queries.history',
      'queries.list',
      'queries.read',
      'queries.revert',
      'queries.update',
    ])
    for (const c of [
      queriesListCapability,
      queriesReadCapability,
      queriesHistoryCapability,
    ]) {
      expect(c.permissions, c.id).toEqual(['queries.read'])
    }
    for (const c of [
      queriesCreateCapability,
      queriesUpdateCapability,
      queriesDeleteCapability,
      queriesRevertCapability,
    ]) {
      expect(c.permissions, c.id).toEqual(['queries.write'])
      expect(c.requiresConfirmation, c.id).toBeTruthy()
    }
  })

  it('create は式を検証してから確認を出し、承認後にライブラリへ入れる (カラムには適用しない)', async () => {
    // 副作用に届く式は preflight で拒否 (保存の不変条件 (c))
    expect(
      queriesCreateCapability.preflight?.({
        name: 'x',
        src: 'Mk:api("notes/create", {})',
      }),
    ).toMatchObject({ error: expect.stringContaining('rejected') })
    // 式として壊れているものも拒否
    expect(
      queriesCreateCapability.preflight?.({ name: 'x', src: 'note.text !=' }),
    ).toMatchObject({
      error: expect.stringContaining('rejected'),
    })
    // 純粋な式は受ける (QIR 外でも降格で動くものを含む)
    expect(
      queriesCreateCapability.preflight?.({
        name: 'x',
        src: 'note.text != null',
      }),
    ).toBeNull()

    const confirm = queriesCreateCapability.requiresConfirmation
    expect(typeof confirm).toBe('function')
    if (typeof confirm === 'function') {
      const c = await confirm(
        { name: 'Only text', src: 'note.text != null' },
        ctx,
      )
      expect(c?.code).toBe('note.text != null')
      expect(c?.message).toContain('Only text')
    }

    const r = (await queriesCreateCapability.execute(
      { name: 'Only text', src: 'note.text != null', description: 'd' },
      ctx,
    )) as { id: string; name: string }
    const store = useColumnQueriesStore()
    const q = store.get(r.id)
    expect(q?.name).toBe('Only text')
    expect(q?.content).toBe('note.text != null')
    expect(q?.description).toBe('d')
    // ライブラリにだけ入る (どのスコープにも参加しない)
    expect(q?.scope).toEqual({
      kind: 'shared',
      global: false,
      installedFor: [],
    })
    expect(q?.extra.active).toBe(true)
  })

  it('create は name / src が無いと失敗する', async () => {
    await expect(
      queriesCreateCapability.execute({ src: 'note.text != null' }, ctx),
    ).rejects.toThrow(/name is required/)
    await expect(
      queriesCreateCapability.execute({ name: 'x' }, ctx),
    ).rejects.toThrow(/src is required/)
  })

  it('update は現状との diff を確認に出し、承認後に全文置換する。無い id は確認を出さず実行で失敗', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'Q', content: 'note.text != null' })
    const confirm = queriesUpdateCapability.requiresConfirmation
    expect(typeof confirm).toBe('function')
    if (typeof confirm === 'function') {
      expect(
        await confirm({ id: 'nope', src: 'note.cw != null' }, ctx),
      ).toBeNull()
      const c = await confirm({ id: q.id, src: 'note.cw != null' }, ctx)
      expect(c?.diff).toEqual({
        old: 'note.text != null',
        new: 'note.cw != null',
        language: 'aiscript',
      })
    }
    const r = (await queriesUpdateCapability.execute(
      { id: q.id, src: 'note.cw != null', reason: 'cw' },
      ctx,
    )) as { id: string; length: number }
    expect(r).toEqual({ id: q.id, length: 'note.cw != null'.length })
    expect(store.get(q.id)?.content).toBe('note.cw != null')
    await expect(
      queriesUpdateCapability.execute(
        { id: 'nope', src: 'note.cw != null' },
        ctx,
      ),
    ).rejects.toThrow(/not found/)
  })
})

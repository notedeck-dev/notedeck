// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: false }
})

import { useColumnQueriesStore } from '@/stores/columnQueries'

describe('useColumnQueriesStore.removeQuery (undo) — #988', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('元の位置に戻す undo を返す', async () => {
    const store = useColumnQueriesStore()
    await store.createQuery({ name: 'a', src: 'true' })
    const b = await store.createQuery({ name: 'b', src: 'note.text != null' })
    await store.createQuery({ name: 'c', src: 'true' })

    const undo = await store.removeQuery(b.id)
    expect(store.getQuery(b.id)).toBeUndefined()
    expect(undo).toBeTypeOf('function')

    undo?.()
    expect(store.queries.map((q) => q.name)).toEqual(['a', 'b', 'c'])
    expect(store.getQuery(b.id)?.src).toBe('note.text != null')
  })

  it('未知の id には undefined を返す', async () => {
    const store = useColumnQueriesStore()
    expect(await store.removeQuery('nope')).toBeUndefined()
  })

  it('undo までに同じ id が再追加されていたら二重化しない', async () => {
    const store = useColumnQueriesStore()
    const a = await store.createQuery({ name: 'a', src: 'true' })

    const undo = await store.removeQuery(a.id)
    store.queries = [{ ...a, name: 'readded' }]
    undo?.()

    expect(store.queries.filter((q) => q.id === a.id)).toHaveLength(1)
    expect(store.getQuery(a.id)?.name).toBe('readded')
  })
})

describe('applyStoreUpdate (#913 ストア再インストール)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('src / description / sha を上書きし name (ローカル改名) は維持する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({
      name: 'My Renamed',
      src: 'old',
      storeId: 'ent-query',
    })
    await store.applyStoreUpdate(q.id, {
      src: 'new',
      description: 'd2',
      storeSha512: 'abc',
      storeVersion: '2.0.0',
    })
    expect(store.getQuery(q.id)).toMatchObject({
      name: 'My Renamed',
      src: 'new',
      description: 'd2',
      storeSha512: 'abc',
      storeVersion: '2.0.0',
    })
  })

  it('ソース欠損の readOnly 個体は検証済み配布ソースで復旧する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({
      name: 'a',
      src: '',
      storeId: 'ent-query',
    })
    store.queries = [{ ...q, readOnly: true }]
    await store.applyStoreUpdate(q.id, {
      src: 'recovered',
      storeSha512: 'abc',
      storeVersion: '1.0.0',
    })
    expect(store.getQuery(q.id)?.src).toBe('recovered')
    expect(store.getQuery(q.id)?.readOnly).toBeFalsy()
  })
})

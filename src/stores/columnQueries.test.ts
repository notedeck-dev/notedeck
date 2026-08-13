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

import {
  isQueryEffectiveFor,
  useColumnQueriesStore,
} from '@/stores/columnQueries'

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

describe('クエリのスコープ (#1018) — 全体 / アカウント別 / ライブラリ', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('全体スコープのクエリはどのアカウント文脈でも有効', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({
      name: 'g',
      src: 'true',
      scope: { kind: 'global' },
    })

    expect(isQueryEffectiveFor(q, 'example.com:u1')).toBe(true)
    // アカウント文脈なし (全アカウントのカラム) でも有効
    expect(isQueryEffectiveFor(q, null)).toBe(true)
  })

  it('アカウント別スコープのクエリはそのアカウントでだけ有効', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({
      name: 'a',
      src: 'true',
      scope: { kind: 'account', key: 'example.com:u1' },
    })

    expect(isQueryEffectiveFor(q, 'example.com:u1')).toBe(true)
    expect(isQueryEffectiveFor(q, 'other.example:u2')).toBe(false)
    expect(isQueryEffectiveFor(q, null)).toBe(false)
  })

  it('どのスコープにも属さないクエリはライブラリのみ (どこでも無効)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'lib', src: 'true' })

    expect(isQueryEffectiveFor(q, 'example.com:u1')).toBe(false)
    expect(isQueryEffectiveFor(q, null)).toBe(false)
  })

  it('スコープへの参加と離脱ができる (本体はライブラリに残る)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'q', src: 'true' })
    const scope = { kind: 'account', key: 'example.com:u1' } as const

    store.linkScope(q.id, scope)
    const linked = store.getQuery(q.id)
    expect(linked && isQueryEffectiveFor(linked, 'example.com:u1')).toBe(true)

    store.unlinkScope(q.id, scope)
    const unlinked = store.getQuery(q.id)
    expect(unlinked && isQueryEffectiveFor(unlinked, 'example.com:u1')).toBe(
      false,
    )
    // 本体は残る
    expect(store.getQuery(q.id)).toBeDefined()
  })

  it('複数アカウントのスコープに同時参加できる', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'q', src: 'true' })

    store.linkScope(q.id, { kind: 'account', key: 'a:1' })
    store.linkScope(q.id, { kind: 'account', key: 'b:2' })

    const stored = store.getQuery(q.id)
    expect(stored && isQueryEffectiveFor(stored, 'a:1')).toBe(true)
    expect(stored && isQueryEffectiveFor(stored, 'b:2')).toBe(true)
    expect(stored && isQueryEffectiveFor(stored, 'c:3')).toBe(false)
  })

  it('スコープ導入前のクエリは全体スコープへ移行する', async () => {
    // scoped 印を持たない旧個体を localStorage ミラーに直接置く
    localStorage.setItem(
      'nd-column-queries',
      JSON.stringify([
        {
          id: 'legacy',
          name: '旧クエリ',
          src: 'true',
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    )
    const store = useColumnQueriesStore()
    store.ensureLoaded()

    const migrated = store.getQuery('legacy')
    expect(migrated?.global).toBe(true)
    expect(migrated && isQueryEffectiveFor(migrated, null)).toBe(true)
  })

  it('ライブラリへ落とした個体は再読込しても全体スコープに戻らない', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({
      name: 'q',
      src: 'true',
      scope: { kind: 'global' },
    })
    store.unlinkScope(q.id, { kind: 'global' })

    // 別インスタンスで読み直す (移行が再び走らないこと)
    setActivePinia(createPinia())
    const reloaded = useColumnQueriesStore()
    reloaded.ensureLoaded()

    expect(reloaded.getQuery(q.id)?.global).toBeUndefined()
  })
})

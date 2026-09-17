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

vi.mock('@/services/columnQuery/degradedRunner', () => ({
  releaseSharedSuspension: vi.fn(),
}))

import { releaseSharedSuspension } from '@/services/columnQuery/degradedRunner'
import {
  isQueryActive,
  isQueryEffectiveFor,
  type NamedQueryMeta,
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

describe('ソース編集でサスペンドを解除する (#783 追補 D / #1112)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.mocked(releaseSharedSuspension).mockClear()
  })

  it('src が変わる編集はそのクエリのサスペンドを解除する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'old' })
    await store.updateQuery(q.id, { src: 'new' })
    expect(releaseSharedSuspension).toHaveBeenCalledWith(q.id)
  })

  it('名前・説明だけの編集では解除しない', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'old' })
    await store.updateQuery(q.id, { name: 'b', description: 'd' })
    expect(releaseSharedSuspension).not.toHaveBeenCalled()
  })

  it('src が同じ内容の保存では解除しない', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'same' })
    await store.updateQuery(q.id, { name: 'b', src: 'same' })
    expect(releaseSharedSuspension).not.toHaveBeenCalled()
  })

  it('ストア更新でソースが変わったときも解除する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'old', storeId: 's' })
    await store.applyStoreUpdate(q.id, {
      src: 'new',
      storeSha512: 'abc',
      storeVersion: '2.0.0',
    })
    expect(releaseSharedSuspension).toHaveBeenCalledWith(q.id)
  })
})

describe('クエリの有効 / 無効 (#1043) — 本体のキルスイッチ', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('値が無ければ有効、無効の印があれば無効', () => {
    const base: NamedQueryMeta = {
      id: 'q',
      name: 'q',
      src: 'true',
      createdAt: 0,
      updatedAt: 0,
    }
    expect(isQueryActive(base)).toBe(true)
    expect(isQueryActive({ ...base, disabled: true })).toBe(false)
    expect(isQueryActive({ ...base, disabled: false })).toBe(true)
  })

  it('新規作成・ストア導入で生まれた個体は有効', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'true', storeId: 's' })
    expect(isQueryActive(q)).toBe(true)
    expect('disabled' in q).toBe(false)
  })

  it('無効にすると印が保存され、有効に戻すと印ごと消える (省略書式)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'true' })
    expect(await store.setDisabled(q.id, true)).toBe(true)
    expect(store.getQuery(q.id)?.disabled).toBe(true)
    const mirrored = () =>
      JSON.parse(localStorage.getItem('nd-column-queries') ?? '[]').find(
        (m: { id: string }) => m.id === q.id,
      )
    expect(mirrored().disabled).toBe(true)

    expect(await store.setDisabled(q.id, false)).toBe(true)
    expect(store.getQuery(q.id)?.disabled).toBeUndefined()
    expect('disabled' in mirrored()).toBe(false)
  })

  it('読取専用 (ソース欠損) の個体は切り替えを拒否する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: '' })
    store.queries = [{ ...q, readOnly: true }]
    expect(await store.setDisabled(q.id, true)).toBe(false)
    expect(store.getQuery(q.id)?.disabled).toBeUndefined()
    const mirrored = JSON.parse(
      localStorage.getItem('nd-column-queries') ?? '[]',
    ).find((m: { id: string }) => m.id === q.id)
    expect(mirrored?.disabled).toBeUndefined()
  })

  it('ストア更新では無効のまま維持する (#1040)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'old', storeId: 's' })
    await store.setDisabled(q.id, true)
    await store.applyStoreUpdate(q.id, {
      src: 'new',
      storeSha512: 'abc',
      storeVersion: '2.0.0',
    })
    expect(store.getQuery(q.id)?.disabled).toBe(true)
  })

  it('削除の undo は削除時の無効を復元する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'a', src: 'true' })
    await store.setDisabled(q.id, true)
    const undo = await store.removeQuery(q.id)
    await undo?.()
    expect(store.getQuery(q.id)?.disabled).toBe(true)
  })
})

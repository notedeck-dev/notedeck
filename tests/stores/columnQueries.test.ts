// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import { useDeckStore } from '@/stores/deck'

/**
 * 名前付きカラムクエリのプール (#783 Phase 1.5)。
 * テスト環境は isTauri=false なので localStorage ミラーのみで動く。
 */

describe('columnQueries store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('createQuery → getQuery → updateQuery → removeQuery の CRUD', async () => {
    const store = useColumnQueriesStore()
    const created = await store.createQuery({
      name: 'テスト',
      src: 'note.cw == null',
      description: '説明',
    })
    expect(created.id).toMatch(/^qry-/)
    expect(store.getQuery(created.id)?.name).toBe('テスト')

    await store.updateQuery(created.id, {
      name: '改名',
      src: 'note.text != null',
    })
    const updated = store.getQuery(created.id)
    expect(updated?.name).toBe('改名')
    expect(updated?.src).toBe('note.text != null')
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    await store.removeQuery(created.id)
    expect(store.getQuery(created.id)).toBeUndefined()
  })

  it('storeId 付きで作成するとストア由来として保持される', async () => {
    const store = useColumnQueriesStore()
    const created = await store.createQuery({
      name: 'ストア配布',
      src: 'note.localOnly == true',
      storeId: 'no-federation',
      iconUrl: 'https://example.com/icon.svg',
    })
    expect(store.getQuery(created.id)?.storeId).toBe('no-federation')
    expect(store.getQuery(created.id)?.iconUrl).toBe(
      'https://example.com/icon.svg',
    )
  })

  it('localStorage ミラーに永続化され再ロードで復元される', async () => {
    const store = useColumnQueriesStore()
    await store.createQuery({ name: '永続', src: 'note.cw == null' })

    // 新しい pinia = アプリ再起動相当
    setActivePinia(createPinia())
    const reloaded = useColumnQueriesStore()
    reloaded.ensureLoaded()
    expect(reloaded.queries).toHaveLength(1)
    expect(reloaded.queries[0]?.name).toBe('永続')
  })

  it('refCountByQueryId がカラムの noteQueryRefs を集計する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.createQuery({ name: 'A', src: 'note.cw == null' })

    const deckStore = useDeckStore()
    deckStore.columns.push(
      {
        id: 'c1',
        type: 'timeline',
        name: null,
        width: 300,
        accountId: 'a1',
        noteQueryRefs: [q.id],
      },
      {
        id: 'c2',
        type: 'timeline',
        name: null,
        width: 300,
        accountId: 'a1',
        noteQueryRefs: [q.id, 'missing-id'],
      },
    )

    expect(store.refCountByQueryId[q.id]).toBe(2)
    expect(store.refCountByQueryId['missing-id']).toBe(1)
  })
})

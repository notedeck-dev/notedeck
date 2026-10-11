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

  it('add → get → update → remove の CRUD', async () => {
    const store = useColumnQueriesStore()
    const created = await store.add({
      name: 'テスト',
      content: 'note.cw == null',
      description: '説明',
    })
    expect(created.id).toMatch(/^qry-/)
    expect(store.get(created.id)?.name).toBe('テスト')

    await store.update(created.id, {
      name: '改名',
      content: 'note.text != null',
    })
    const updated = store.get(created.id)
    expect(updated?.name).toBe('改名')
    expect(updated?.content).toBe('note.text != null')
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    await store.remove(created.id)
    expect(store.get(created.id)).toBeUndefined()
  })

  it('ストア由来で作成するとその 3 点を保持する', async () => {
    const store = useColumnQueriesStore()
    const created = await store.add({
      name: 'ストア配布',
      content: 'note.localOnly == true',
      store: { id: 'no-federation' },
      iconUrl: 'https://example.com/icon.svg',
    })
    expect(store.get(created.id)?.store?.id).toBe('no-federation')
    expect(store.get(created.id)?.iconUrl).toBe('https://example.com/icon.svg')
  })

  it('localStorage ミラーに永続化され再ロードで復元される', async () => {
    const store = useColumnQueriesStore()
    await store.add({ name: '永続', content: 'note.cw == null' })

    // 新しい pinia = アプリ再起動相当
    setActivePinia(createPinia())
    const reloaded = useColumnQueriesStore()
    reloaded.ensureLoaded()
    expect(reloaded.items).toHaveLength(1)
    expect(reloaded.items[0]?.name).toBe('永続')
  })

  it('refCountByQueryId がカラムの noteQueryRefs を集計する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'A', content: 'note.cw == null' })

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

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

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

import { releaseSharedSuspension } from '@/services/columnQuery/degradedRunner'
import { isInScope } from '@/services/distributable'
import {
  isQueryActive,
  isQueryOfferedFor,
  isQueryOfferedForAny,
  type QueryItem,
  useColumnQueriesStore,
} from '@/stores/columnQueries'
import { pushSnapshot } from '@/utils/historyFs'

const STORE = { id: 's', sha512: 'h0', version: '1.0.0' }

function fixture(partial: Partial<QueryItem> & { id: string }): QueryItem {
  return {
    name: partial.id,
    content: 'true',
    scope: { kind: 'shared', global: false, installedFor: [] },
    extra: { scoped: true, active: true },
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

const mirrored = (id: string) =>
  JSON.parse(localStorage.getItem('nd-column-queries') ?? '[]').find(
    (m: { id: string }) => m.id === id,
  )

describe('useColumnQueriesStore.remove (undo) — #988', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('元の位置に戻す undo を返す', async () => {
    const store = useColumnQueriesStore()
    await store.add({ name: 'a', content: 'true' })
    const b = await store.add({ name: 'b', content: 'note.text != null' })
    await store.add({ name: 'c', content: 'true' })

    const undo = await store.remove(b.id)
    expect(store.get(b.id)).toBeUndefined()
    expect(undo).toBeTypeOf('function')

    undo?.()
    expect(store.items.map((q) => q.name)).toEqual(['a', 'b', 'c'])
    expect(store.get(b.id)?.content).toBe('note.text != null')
  })

  it('未知の id には undefined を返す', async () => {
    const store = useColumnQueriesStore()
    expect(await store.remove('nope')).toBeUndefined()
  })

  it('undo までに同じ id が再追加されていたら二重化しない', async () => {
    const store = useColumnQueriesStore()
    const a = await store.add({ name: 'a', content: 'true' })

    const undo = await store.remove(a.id)
    store.items = [{ ...a, name: 'readded' }]
    undo?.()

    expect(store.items.filter((q) => q.id === a.id)).toHaveLength(1)
    expect(store.get(a.id)?.name).toBe('readded')
  })
})

describe('applyStoreUpdate (#913 ストア再インストール)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('本文 / description / ストア由来を上書きし name (ローカル改名) は維持する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({
      name: 'My Renamed',
      content: 'old',
      store: { id: 'ent-query' },
    })
    await store.applyStoreUpdate(q.id, {
      content: 'new',
      description: 'd2',
      store: { id: 'ent-query', sha512: 'abc', version: '2.0.0' },
    })
    expect(store.get(q.id)).toMatchObject({
      name: 'My Renamed',
      content: 'new',
      description: 'd2',
      store: { id: 'ent-query', sha512: 'abc', version: '2.0.0' },
    })
  })

  it('ソース欠損の readOnly 個体は検証済み配布ソースで復旧する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({
      name: 'a',
      content: '',
      store: { id: 'ent-query' },
    })
    store.items = [{ ...q, readOnly: true }]
    await store.applyStoreUpdate(q.id, {
      content: 'recovered',
      store: { id: 'ent-query', sha512: 'abc', version: '1.0.0' },
    })
    expect(store.get(q.id)?.content).toBe('recovered')
    expect(store.get(q.id)?.readOnly).toBeFalsy()
  })
})

describe('クエリのスコープ (#1018) — 全体 / アカウント別 / ライブラリ', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('全体スコープのクエリはどのアカウント文脈でも有効', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({
      name: 'g',
      content: 'true',
      scope: { kind: 'global' },
    })

    expect(isInScope(q.scope, 'example.com:u1')).toBe(true)
    // アカウント文脈なし (全アカウントのカラム) でも有効
    expect(isInScope(q.scope, null)).toBe(true)
  })

  it('アカウント別スコープのクエリはそのアカウントでだけ有効', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({
      name: 'a',
      content: 'true',
      scope: { kind: 'account', key: 'example.com:u1' },
    })

    expect(isInScope(q.scope, 'example.com:u1')).toBe(true)
    expect(isInScope(q.scope, 'other.example:u2')).toBe(false)
    expect(isInScope(q.scope, null)).toBe(false)
  })

  it('どのスコープにも属さないクエリはライブラリのみ (どこでも無効)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'lib', content: 'true' })

    expect(isInScope(q.scope, 'example.com:u1')).toBe(false)
    expect(isInScope(q.scope, null)).toBe(false)
  })

  it('スコープへの参加と離脱ができる (本体はライブラリに残る)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'q', content: 'true' })
    const scope = { kind: 'account', key: 'example.com:u1' } as const

    await store.link(q.id, scope)
    expect(store.get(q.id)?.scope).toMatchObject({
      installedFor: ['example.com:u1'],
    })

    await store.unlink(q.id, scope)
    expect(store.get(q.id)?.scope).toMatchObject({ installedFor: [] })
    // 本体は残る
    expect(store.get(q.id)).toBeDefined()
  })

  it('複数アカウントのスコープに同時参加できる', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'q', content: 'true' })

    await store.link(q.id, { kind: 'account', key: 'a:1' })
    await store.link(q.id, { kind: 'account', key: 'b:2' })

    const stored = store.get(q.id)
    expect(stored && isInScope(stored.scope, 'a:1')).toBe(true)
    expect(stored && isInScope(stored.scope, 'b:2')).toBe(true)
    expect(stored && isInScope(stored.scope, 'c:3')).toBe(false)
  })

  it('スコープ導入前のクエリは全体スコープへ移行する', async () => {
    // scoped 印を持たない旧個体を localStorage ミラーに直接置く
    localStorage.setItem(
      'nd-column-queries',
      JSON.stringify([
        fixture({
          id: 'legacy',
          name: '旧クエリ',
          extra: { scoped: false, active: true },
        }),
      ]),
    )
    const store = useColumnQueriesStore()
    store.ensureLoaded()

    const migrated = store.get('legacy')
    expect(migrated?.scope).toMatchObject({ global: true })
    expect(migrated?.extra.scoped).toBe(true)
  })

  it('ライブラリへ落とした個体は再読込しても全体スコープに戻らない', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({
      name: 'q',
      content: 'true',
      scope: { kind: 'global' },
    })
    await store.unlink(q.id, { kind: 'global' })

    // 別インスタンスで読み直す (移行が再び走らないこと)
    setActivePinia(createPinia())
    const reloaded = useColumnQueriesStore()
    reloaded.ensureLoaded()

    expect(reloaded.get(q.id)?.scope).toMatchObject({ global: false })
  })
})

describe('ソース編集でサスペンドを解除する (#783 追補 D / #1112)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.mocked(releaseSharedSuspension).mockClear()
  })

  it('本文が変わる編集はそのクエリのサスペンドを解除する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'old' })
    await store.update(q.id, { content: 'new' })
    expect(releaseSharedSuspension).toHaveBeenCalledWith(q.id)
  })

  it('名前・説明だけの編集では解除しない', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'old' })
    await store.update(q.id, { name: 'b', description: 'd' })
    expect(releaseSharedSuspension).not.toHaveBeenCalled()
  })

  it('同じ本文の保存では解除しない', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'same' })
    await store.update(q.id, { name: 'b', content: 'same' })
    expect(releaseSharedSuspension).not.toHaveBeenCalled()
  })

  it('有効 / 無効の切替では解除しない (解除は明示の「再開」かソース編集だけ)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'x' })
    await store.setEnabled(q.id, false)
    await store.setEnabled(q.id, true)
    expect(releaseSharedSuspension).not.toHaveBeenCalled()
  })

  it('ストア更新でソースが変わったときも解除する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'old', store: STORE })
    await store.applyStoreUpdate(q.id, {
      content: 'new',
      store: { id: 's', sha512: 'abc', version: '2.0.0' },
    })
    expect(releaseSharedSuspension).toHaveBeenCalledWith(q.id)
  })
})

describe('クエリの有効 / 無効 (#1043) — 本体のキルスイッチ', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('判定は extra.active', () => {
    const base = fixture({ id: 'q' })
    expect(isQueryActive(base)).toBe(true)
    expect(
      isQueryActive({ ...base, extra: { scoped: true, active: false } }),
    ).toBe(false)
  })

  it('新規作成・ストア導入で生まれた個体は有効', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'true', store: STORE })
    expect(isQueryActive(q)).toBe(true)
  })

  it('無効にすると写しと保存に反映され、有効に戻せる', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'true' })
    expect(await store.setEnabled(q.id, false)).toBe(true)
    expect(store.get(q.id)?.extra.active).toBe(false)
    expect(mirrored(q.id).extra.active).toBe(false)

    expect(await store.setEnabled(q.id, true)).toBe(true)
    expect(store.get(q.id)?.extra.active).toBe(true)
    expect(mirrored(q.id).extra.active).toBe(true)
  })

  it('読取専用 (ソース欠損) の個体は切り替えを拒否する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: '' })
    store.items = [{ ...q, readOnly: true }]
    expect(await store.setEnabled(q.id, false)).toBe(false)
    expect(store.get(q.id)?.extra.active).toBe(true)
    expect(mirrored(q.id)?.extra.active).toBe(true)
  })

  it('ストア更新では無効のまま維持する (#1040)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'old', store: STORE })
    await store.setEnabled(q.id, false)
    await store.applyStoreUpdate(q.id, {
      content: 'new',
      store: { id: 's', sha512: 'abc', version: '2.0.0' },
    })
    expect(store.get(q.id)?.extra.active).toBe(false)
  })

  it('削除の undo は削除時の無効を復元する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'true' })
    await store.setEnabled(q.id, false)
    const undo = await store.remove(q.id)
    undo?.()
    expect(store.get(q.id)?.extra.active).toBe(false)
  })
})

describe('読取専用 (ソース欠損) の個体は変更を拒否する (#1111)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('改名・説明の変更も拒否して false を返す (端末ローカルにだけ載せない)', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: '' })
    store.items = [{ ...q, readOnly: true }]
    expect(await store.update(q.id, { name: 'renamed' })).toBe(false)
    expect(store.get(q.id)?.name).toBe('a')
  })

  it('スコープの参加・離脱も拒否する', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({
      name: 'a',
      content: '',
      scope: { kind: 'global' },
    })
    store.items = [{ ...q, readOnly: true }]
    expect(await store.unlink(q.id, { kind: 'global' })).toBe(false)
    expect(store.get(q.id)?.scope).toMatchObject({ global: true })
    expect(await store.link(q.id, { kind: 'account', key: 'h:u' })).toBe(false)
    expect(store.get(q.id)?.scope).toMatchObject({ installedFor: [] })
  })

  it('通常の個体では true を返す', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'true' })
    expect(await store.update(q.id, { name: 'b' })).toBe(true)
    expect(await store.link(q.id, { kind: 'global' })).toBe(true)
  })
})

describe('クエリの編集履歴 (#1117) — 編集前 snapshot を積む', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.mocked(pushSnapshot).mockClear()
  })

  async function seeded() {
    const store = useColumnQueriesStore()
    const q = await store.add({
      name: 'a',
      content: 'old',
      description: 'd',
    })
    const live = store.get(q.id)
    if (live) live.fileBase = 'a'
    return { store, q }
  }

  it('ソースが変わる保存は編集前の src / name / description を積む (履歴の形は on-disk 互換)', async () => {
    const { store, q } = await seeded()
    await store.update(q.id, { content: 'new' })
    expect(pushSnapshot).toHaveBeenCalledTimes(1)
    expect(pushSnapshot).toHaveBeenCalledWith(
      'query',
      'a',
      { src: 'old', name: 'a', description: 'd' },
      undefined,
    )
  })

  it('名前だけの変更でも積む (snapshot に含まれる範囲が動いた)', async () => {
    const { store, q } = await seeded()
    await store.update(q.id, { name: 'b' })
    expect(pushSnapshot).toHaveBeenCalledTimes(1)
  })

  it('同じ内容の保存では積まない', async () => {
    const { store, q } = await seeded()
    await store.update(q.id, { content: 'old', name: 'a', description: 'd' })
    expect(pushSnapshot).not.toHaveBeenCalled()
  })

  it('ファイル未割当 (fileBase 無し) では積まない', async () => {
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'old' })
    await store.update(q.id, { content: 'new' })
    expect(pushSnapshot).not.toHaveBeenCalled()
  })

  it('ストア更新でソースが変わるときも積む', async () => {
    const { store, q } = await seeded()
    await store.applyStoreUpdate(q.id, {
      content: 'new',
      store: { id: 's', sha512: 'abc', version: '2.0.0' },
    })
    expect(pushSnapshot).toHaveBeenCalledTimes(1)
  })
})

describe('アカウント削除でスコープ参加を掃除する (#1114)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('そのアカウントのキーだけを全クエリから外し、本体はライブラリに残す', async () => {
    const store = useColumnQueriesStore()
    const a = await store.add({
      name: 'a',
      content: 'true',
      scope: { kind: 'account', key: 'h:u1' },
    })
    await store.link(a.id, { kind: 'account', key: 'h:u2' })
    const b = await store.add({
      name: 'b',
      content: 'true',
      scope: { kind: 'account', key: 'h:u1' },
    })
    const c = await store.add({
      name: 'c',
      content: 'true',
      scope: { kind: 'global' },
    })
    await store.purgeAccount('h:u1')
    expect(store.get(a.id)?.scope).toMatchObject({ installedFor: ['h:u2'] })
    expect(store.get(b.id)?.scope).toMatchObject({ installedFor: [] })
    expect(store.get(b.id)).toBeDefined()
    expect(store.get(c.id)?.scope).toMatchObject({ global: true })
  })
})

describe('アカウントに紐づかない面の候補 (#1178) — 全体 + ログイン中のどれかのアカウントのスコープ', () => {
  const scoped = fixture({
    id: 's',
    scope: { kind: 'shared', global: false, installedFor: ['alice@a.example'] },
  })
  const global = fixture({
    id: 'g',
    scope: { kind: 'shared', global: true, installedFor: [] },
  })
  const off = (q: QueryItem): QueryItem => ({
    ...q,
    extra: { ...q.extra, active: false },
  })
  const none = new Set<string>()

  it('どれかのアカウントのスコープに入っていれば出す。入っていなければ出さない', () => {
    expect(
      isQueryOfferedForAny(scoped, ['bob@b.example', 'alice@a.example'], none),
    ).toBe(true)
    expect(isQueryOfferedForAny(scoped, ['bob@b.example'], none)).toBe(false)
  })

  it('全体スコープは常に出す。アカウントが 1 つも無ければ全体スコープだけ', () => {
    expect(isQueryOfferedForAny(global, [], none)).toBe(true)
    expect(isQueryOfferedForAny(scoped, [], none)).toBe(false)
  })

  it('無効なら未適用では出さず、適用済みなら出す (#1043 と同じ)', () => {
    expect(isQueryOfferedForAny(off(scoped), ['alice@a.example'], none)).toBe(
      false,
    )
    expect(isQueryOfferedForAny(off(scoped), [], new Set(['s']))).toBe(true)
  })
})

describe('フィルタメニューの候補 (#1043) — 未適用の無効なクエリは出さない', () => {
  const base = fixture({
    id: 'q',
    scope: { kind: 'shared', global: true, installedFor: [] },
  })
  const off: QueryItem = { ...base, extra: { scoped: true, active: false } }
  const none = new Set<string>()
  const applied = new Set(['q'])

  it('有効でスコープ内なら出す', () => {
    expect(isQueryOfferedFor(base, null, none)).toBe(true)
  })

  it('無効で未適用なら出さない (使えない選択肢で場所と認知負荷を食わない)', () => {
    expect(isQueryOfferedFor(off, null, none)).toBe(false)
  })

  it('無効でも適用済みなら出す (外す導線と、効いていない理由を追えるように)', () => {
    expect(isQueryOfferedFor(off, null, applied)).toBe(true)
  })

  it('スコープ外でも適用済みなら出す (従来どおり)', () => {
    const scoped = fixture({
      id: 'q',
      scope: { kind: 'shared', global: false, installedFor: ['h:u2'] },
    })
    expect(isQueryOfferedFor(scoped, 'h:u1', none)).toBe(false)
    expect(isQueryOfferedFor(scoped, 'h:u1', applied)).toBe(true)
  })
})

describe('クエリの改名は履歴の書き込みを待つ (#1118 レビュー指摘)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.mocked(pushSnapshot).mockClear()
  })

  it('履歴の書き込みが終わるまで保存 (改名を含む) を進めない', async () => {
    let release: (() => void) | undefined
    vi.mocked(pushSnapshot).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const store = useColumnQueriesStore()
    const q = await store.add({ name: 'a', content: 'old' })
    const live = store.get(q.id)
    if (live) live.fileBase = 'a'

    let done = false
    const saving = store
      .update(q.id, { name: 'b', content: 'new' })
      .then(() => {
        done = true
      })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(done).toBe(false)

    release?.()
    await saving
    expect(done).toBe(true)
    expect(store.get(q.id)?.name).toBe('b')
  })
})

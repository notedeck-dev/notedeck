// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type App,
  createApp,
  defineComponent,
  nextTick,
  type Ref,
  ref,
} from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type { NormalizedNote, NoteUpdateEvent } from '@/adapters/types'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { variantKey } from '@/services/noteKey'
import { matchesFilter } from '@/services/timelineFilter'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { type QueryItem, useColumnQueriesStore } from '@/stores/columnQueries'
import type { DeckColumn } from '@/stores/deck'
import { useNoteStore } from '@/stores/notes'
import { usePerformanceStore } from '@/stores/performance'
import { useToast } from '@/stores/toast'
import { useCrossAccountNotes } from './useCrossAccountNotes'

/**
 * 全アカウント面 (useCrossAccountNotes) のテスト土台。
 *
 * per-account の useNoteColumn.dom.test.ts と同じ方針で、Tauri コマンド・
 * 🐢 runner・adapter 生成・dedup Worker を差し替え、取り込み経路 (初回 /
 * 追加読み込み / 復帰 / streaming) にフィルタとクエリが通ることをカラム側の
 * 接続として検証する。アカウントごとの取得は `fetchFor` で差し替える。
 */

// tauri-specta bindings: 全コマンドを空成功で応答 (SQLite キャッシュは空扱い)
const bindings = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
  responses: {} as Record<string, unknown>,
}))
vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        (...args: unknown[]) => {
          bindings.calls.push({ name, args })
          const r = bindings.responses[name]
          const data = typeof r === 'function' ? r(...args) : (r ?? [])
          return Promise.resolve({ status: 'ok', data })
        },
    },
  ),
}))

// streaming batch の flush は frameEngine の RAF ループに乗る。テストではループが
// 起動していないので、scheduler をマイクロタスク実行に差し替えて決定的にする
vi.mock('@/composables/useFrameScheduler', () => ({
  useFrameScheduler: () => ({
    schedule: (fn: () => void) => queueMicrotask(fn),
    cancel: () => undefined,
    dispose: () => undefined,
  }),
}))

// dedup Worker は happy-dom に無いので常に失敗させ、メインスレッド fallback を通す
vi.mock('@/utils/workerClient', () => ({
  createWorkerClient: () => ({
    post: () => Promise.reject(new Error('no worker in test')),
  }),
}))

// 🐢 runner を Worker 抜きで差し替える (評価ロジックは本物)
const degraded = vi.hoisted(() => ({
  suspended: new Set<string>(),
  runCalls: [] as { keys: string[]; noteCount: number }[],
  listeners: new Set<() => void>(),
}))
vi.mock('@/services/columnQuery/degradedRunner', async () => {
  const { createDegradedBatchRunner } = await vi.importActual<
    typeof import('@/services/columnQuery/degradedBatch')
  >('@/services/columnQuery/degradedBatch')
  return {
    getSharedDegradedRunner: () => ({
      run: async (
        filters: { key: string; source: string }[],
        notes: unknown[],
      ) => {
        degraded.runCalls.push({
          keys: filters.map((f) => f.key),
          noteCount: notes.length,
        })
        if (filters.some((f) => degraded.suspended.has(f.key))) {
          return {
            verdicts: notes.map(() => 'error' as const),
            invalidFilters: [],
            suspended: [],
          }
        }
        const batch = createDegradedBatchRunner()
        const out = batch.run(filters, notes)
        batch.dispose()
        return { ...out, suspended: [] }
      },
      isSuspended: (key: string) => degraded.suspended.has(key),
      suspendedKeys: () => [...degraded.suspended],
      resume: (key: string) => {
        degraded.suspended.delete(key)
        for (const l of degraded.listeners) l()
      },
      subscribe: (listener: () => void) => {
        degraded.listeners.add(listener)
        return () => degraded.listeners.delete(listener)
      },
      dispose: () => undefined,
    }),
    releaseSharedSuspension: () => undefined,
  }
})

// アカウントごとの adapter。stream は購読 API だけ持つ空実装
const adapters = vi.hoisted(() => new Map<string, unknown>())
function makeStream() {
  return {
    connect: vi.fn(),
    reconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    subNote: vi.fn(),
    unsubNote: vi.fn(),
    cleanup: vi.fn(),
  }
}
vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async (_host: string, accountId: string) => {
    let adapter = adapters.get(accountId)
    if (!adapter) {
      adapter = { api: {}, stream: makeStream(), accountId }
      adapters.set(accountId, adapter)
    }
    return { adapter, serverInfo: { iconUrl: '' } }
  }),
}))

function note(id: string, extra: Partial<NormalizedNote> = {}): NormalizedNote {
  return {
    id,
    createdAt: `2026-07-01T00:00:${id.slice(-2).padStart(2, '0')}.000Z`,
    text: id,
    cw: null,
    visibility: 'public',
    user: { id: `user-${id}`, username: id, host: null },
    files: [],
    reactions: {},
    ...extra,
  } as unknown as NormalizedNote
}

/** 取得元アカウントを付ける (実 adapter の正規化と同じ) */
function stamp(n: NormalizedNote, accountId: string): NormalizedNote {
  return { ...n, _accountId: accountId, _serverHost: 'example.com' }
}

async function flush(rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

/**
 * streaming の新着は scheduler (差し替え済み = マイクロタスク) → batch → 列の順に
 * 流れる。全アカウント面の取り込みは mapWithConcurrency → admit → dedup と段が
 * 多く、per-account より収束に周回が要る (flush の既定 40 周も同じ理由)
 */
async function flushFrames() {
  await flush(60)
}

function addAccount(id: string, host = 'example.com', hasToken = true) {
  useAccountsStore().accounts.push({
    id,
    host,
    userId: `uid-${id}`,
    username: id,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken,
  } as Account)
}

function seedQuery(
  id: string,
  src: string,
  extra: Partial<QueryItem['extra']> = {},
): void {
  const store = useColumnQueriesStore()
  store.ensureLoaded()
  store.items.push({
    id,
    name: `named-${id}`,
    content: src,
    scope: { kind: 'shared', global: true, installedFor: [] },
    extra: { scoped: true, active: true, ...extra },
    createdAt: 0,
    updatedAt: 0,
  })
}

let apps: App[] = []
let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  bindings.calls.length = 0
  for (const k of Object.keys(bindings.responses)) delete bindings.responses[k]
  bindings.responses.apiVerifyNotes = { verified: {}, missing: [] }
  degraded.suspended.clear()
  degraded.runCalls.length = 0
  degraded.listeners.clear()
  adapters.clear()
  vi.mocked(initAdapterFor).mockClear()
  useToast().toasts.value.length = 0
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  for (const app of apps) app.unmount()
  apps = []
})

interface Live {
  enqueue: (note: NormalizedNote) => void
  onNoteUpdated: (event: NoteUpdateEvent) => void
}
type HostSetup = Pick<
  ReturnType<typeof useColumnSetup>,
  'handlers' | 'postForm'
>

/**
 * 全アカウント TL カラム相当の設定で useCrossAccountNotes をマウントする。
 * `fetchFor(accountId, opts)` がそのアカウントの取得結果を返す。
 */
function mountCross(opts: {
  column: Ref<Partial<DeckColumn>>
  fetchFor: (
    accountId: string,
    opts?: { untilId?: string },
  ) => NormalizedNote[] | Promise<NormalizedNote[]>
  streaming?: boolean
  paging?: 'horizon'
}) {
  const live = new Map<string, Live>()
  let api: ReturnType<typeof useCrossAccountNotes> | null = null
  let setup: HostSetup | null = null
  const columnOf = () =>
    ({
      id: 'col-cross',
      type: 'timeline',
      accountId: null,
      tl: 'home',
      ...opts.column.value,
    }) as DeckColumn
  const Host = defineComponent({
    setup() {
      const { isLoading, error, scroller, onScrollReport, handlers, postForm } =
        useColumnSetup(() => columnOf())
      setup = { handlers, postForm }
      api = useCrossAccountNotes({
        // 実 adapter は取得元アカウント (_accountId) を付けて返す。全アカウント
        // 面は variant キーと追加読み込みの位置決めにこれを使うので土台でも付ける
        fetchNotes: async (adapter, o) => {
          const accountId = (adapter as unknown as { accountId: string })
            .accountId
          const fetched = await opts.fetchFor(accountId, o)
          return fetched.map((n) => stamp(n, accountId))
        },
        isCrossAccount: () => true,
        cacheKey: () => 'home',
        paging: opts.paging,
        isLoading,
        error,
        scroller,
        onScrollReport,
        deleteNote: handlers.delete,
        filter: {
          getColumn: columnOf,
          builtinAdmits: (n) => matchesFilter(n, columnOf().filters, 'home'),
        },
        streaming: opts.streaming
          ? {
              columnId: 'col-cross',
              subscribe: (accountId, _adapter, enqueue, callbacks) => {
                live.set(accountId, {
                  enqueue: (n) => enqueue(stamp(n, accountId)),
                  onNoteUpdated: callbacks.onNoteUpdated,
                })
                return { dispose: vi.fn() }
              },
            }
          : undefined,
      })
      return () => null
    },
  })
  const app = createApp(Host)
  app.use(pinia)
  app.mount(document.createElement('div'))
  apps.push(app)
  if (!api || !setup) throw new Error('harness setup failed')
  return {
    api: api as ReturnType<typeof useCrossAccountNotes>,
    live,
    ...(setup as HostSetup),
  }
}

/** 取得元アカウントの adapter を API モック付きで先に登録する */
function seedAdapter(accountId: string) {
  const api = {
    createNote: vi.fn(async () => ({})),
    deleteNote: vi.fn(async () => undefined),
    getNote: vi.fn(async () => undefined),
    createFavorite: vi.fn(async () => undefined),
    deleteFavorite: vi.fn(async () => undefined),
    createReaction: vi.fn(async () => undefined),
    deleteReaction: vi.fn(async () => undefined),
  }
  adapters.set(accountId, { api, stream: makeStream(), accountId })
  return api
}

function ids(api: ReturnType<typeof useCrossAccountNotes>): string[] {
  return api.notes.value.map((n) => n.id)
}

describe('useCrossAccountNotes: 組込フィルタ (#841) が全アカウント面でも効く', () => {
  it('初回取得でカラムの組込フィルタをクライアント側でも通す', async () => {
    addAccount('acc-a')
    addAccount('acc-b', 'other.example')
    const column = ref<Partial<DeckColumn>>({
      filters: { withReplies: false },
    })
    const { api } = mountCross({
      column,
      fetchFor: (accountId) =>
        accountId === 'acc-a'
          ? [note('a01'), note('a02', { reply: { id: 'x' } } as never)]
          : [note('b01', { reply: { id: 'y' } } as never)],
    })
    await flush()
    expect(ids(api)).toEqual(['a01'])
  })

  it('フィルタ変更で表示中ノートへ即時適用し、取り直す', async () => {
    addAccount('acc-a')
    const fetchFor = vi.fn(() => [
      note('a01'),
      note('a02', { reply: { id: 'x' } } as never),
    ])
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({ column, fetchFor })
    await flush()
    expect(ids(api)).toEqual(['a02', 'a01'])
    const calls = fetchFor.mock.calls.length

    column.value = { filters: { withReplies: false } }
    await flush(20)
    expect(ids(api)).toEqual(['a01'])
    expect(fetchFor.mock.calls.length).toBeGreaterThan(calls)
  })
})

describe('useCrossAccountNotes: カラムクエリ (#783) が全アカウント面でも効く', () => {
  it('全体スコープの名前付きクエリで絞り込み、状態は active', async () => {
    seedQuery('q-fast', 'note.text != null && note.text.incl("keep")')
    addAccount('acc-a')
    const column = ref<Partial<DeckColumn>>({ noteQueryRefs: ['q-fast'] })
    const { api } = mountCross({
      column,
      fetchFor: () => [
        note('a01', { text: 'keep me' } as never),
        note('a02', { text: 'drop' } as never),
      ],
    })
    await flush()
    expect(ids(api)).toEqual(['a01'])
    expect(api.columnQueryState.value.status).toBe('active')
    expect(api.columnQueryExcludedCount.value).toBe(1)
  })

  it('🐢 (逐次適用) のクエリも Worker 経由で効き、状態は degraded', async () => {
    seedQuery('q-slow', 'note.text != null && note.text.len > 3')
    addAccount('acc-a')
    const column = ref<Partial<DeckColumn>>({ noteQueryRefs: ['q-slow'] })
    const { api } = mountCross({
      column,
      fetchFor: () => [
        note('a01', { text: 'long text' } as never),
        note('a02', { text: 'no' } as never),
      ],
    })
    await flush()
    expect(ids(api)).toEqual(['a01'])
    expect(api.columnQueryState.value.status).toBe('degraded')
    expect(degraded.runCalls.length).toBeGreaterThan(0)
  })

  it('無効なクエリは評価上「無いもの」で、状態は disabled (#1043)', async () => {
    seedQuery('q-off', 'note.text != null && note.text.incl("keep")', {
      active: false,
    })
    addAccount('acc-a')
    const column = ref<Partial<DeckColumn>>({ noteQueryRefs: ['q-off'] })
    const { api } = mountCross({
      column,
      fetchFor: () => [
        note('a01', { text: 'keep me' } as never),
        note('a02', { text: 'drop' } as never),
      ],
    })
    await flush()
    expect(ids(api)).toEqual(['a02', 'a01'])
    expect(api.columnQueryState.value.status).toBe('disabled')
  })

  it('参照消失は fail-closed のまま', async () => {
    addAccount('acc-a')
    const column = ref<Partial<DeckColumn>>({ noteQueryRefs: ['q-gone'] })
    const { api } = mountCross({ column, fetchFor: () => [note('a01')] })
    await flush()
    expect(ids(api)).toEqual([])
    expect(api.columnQueryState.value.status).toBe('invalid')
    expect(api.columnQueryMissingIds.value).toEqual(['q-gone'])
  })

  it('追加読み込みの古いページにもクエリが通る', async () => {
    seedQuery('q-fast', 'note.text != null && note.text.incl("keep")')
    addAccount('acc-a')
    const column = ref<Partial<DeckColumn>>({ noteQueryRefs: ['q-fast'] })
    const { api } = mountCross({
      column,
      fetchFor: (_id, o) =>
        o?.untilId
          ? [
              note('a00', { text: 'keep old' } as never),
              note('a-9', { text: 'drop old' } as never),
            ]
          : [note('a05', { text: 'keep' } as never)],
    })
    await flush()
    expect(ids(api)).toEqual(['a05'])
    await api.loadMoreCrossAccount()
    await flush()
    expect(ids(api)).toEqual(['a05', 'a00'])
  })
})

describe('useCrossAccountNotes: 水平線で下端を揃える (#1184)', () => {
  /** 取得の呼び出し記録: accountId と untilId */
  function recorder(
    pages: Record<string, (untilId?: string) => NormalizedNote[]>,
  ) {
    const calls: { id: string; untilId?: string }[] = []
    return {
      calls,
      fetchFor: (id: string, o?: { untilId?: string }) => {
        calls.push({ id, untilId: o?.untilId })
        return pages[id]?.(o?.untilId) ?? []
      },
    }
  }

  it('起動時、いちばん浅いアカウントの最古行より古い行は隠す', async () => {
    addAccount('acc-a')
    addAccount('acc-b')
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({
      column,
      paging: 'horizon',
      fetchFor: (id) =>
        id === 'acc-a'
          ? [note('a50'), note('a40')]
          : [note('b30'), note('b10')],
    })
    await flush()
    // acc-a は :40 までしか取れていないので、:30 以前の acc-b の行はまだ出さない
    expect(ids(api)).toEqual(['a50', 'a40'])
    expect(api.hiddenGroups.value.map((g) => g.primary.id)).toEqual([
      'b30',
      'b10',
    ])
  })

  it('追加読み込みは水平線を決めているアカウントだけ遡り、尽きたら次のアカウントへ', async () => {
    addAccount('acc-a')
    addAccount('acc-b')
    const rec = recorder({
      'acc-a': (u) =>
        u
          ? u === 'a40'
            ? [note('a35'), note('a33')]
            : []
          : [note('a50'), note('a40')],
      'acc-b': (u) => (u ? [note('b05')] : [note('b30'), note('b10')]),
    })
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({
      column,
      paging: 'horizon',
      fetchFor: rec.fetchFor,
    })
    await flush()
    await api.loadMoreCrossAccount()
    await flush()
    expect(ids(api)).toEqual(['a50', 'a40', 'a35', 'a33'])
    // acc-b は追加読み込みされていない
    expect(rec.calls.filter((c) => c.id === 'acc-b' && c.untilId)).toHaveLength(
      0,
    )
    // acc-a が尽きると水平線は acc-b に移り、隠れていた行が出る
    await api.loadMoreCrossAccount()
    await flush()
    expect(ids(api)).toEqual(['a50', 'a40', 'a35', 'a33', 'b30', 'b10'])
    await api.loadMoreCrossAccount()
    await flush()
    expect(ids(api)).toEqual(['a50', 'a40', 'a35', 'a33', 'b30', 'b10', 'b05'])
    expect(rec.calls.at(-1)).toEqual({ id: 'acc-b', untilId: 'b10' })
  })

  it('切り詰めで行が消えても遡りの位置を失わず、最新ページを取り直さない', async () => {
    // 上限は設定の下限値まで下げる (それより小さくは丸められる)
    const perf = usePerformanceStore()
    perf.set('noteListMax', 1)
    const max = perf.get('noteListMax')
    addAccount('acc-a')
    addAccount('acc-b')
    const a = (sec: number) => note(`a${String(sec).padStart(2, '0')}`)
    const sec = (id: string) => Number(id.slice(1))
    // acc-a: live は :99〜:70 の 30 件、キャッシュは :70 から上限ぶん (live と重なる = 続いている)
    bindings.responses.apiGetCachedTimeline = (accountId: string) =>
      accountId === 'acc-a'
        ? Array.from({ length: max }, (_, i) => stamp(a(70 - i), 'acc-a'))
        : []
    const rec = recorder({
      'acc-a': (u) =>
        u === undefined
          ? Array.from({ length: 30 }, (_, i) => a(99 - i))
          : [a(sec(u) - 1), a(sec(u) - 2)],
      'acc-b': (u) => (u ? [] : [note('b95'), note('b05')]),
    })
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({
      column,
      paging: 'horizon',
      fetchFor: rec.fetchFor,
    })
    await flush()
    // 見えている行で上限まで切り詰められ、acc-a の到達点は列に残った最古行に戻る
    expect(ids(api)).toHaveLength(max)
    expect(ids(api)).toContain('b95')
    const lastA = ids(api).at(-1) ?? ''
    expect(lastA.startsWith('a')).toBe(true)
    await api.loadMoreCrossAccount()
    await flush()
    // 遡りは列に残った最古行から。最新ページを取り直していない
    expect(rec.calls.slice(2)).toEqual([{ id: 'acc-a', untilId: lastA }])
    // 下方向のページングは新しい側を捨てる
    expect(ids(api)).toHaveLength(max)
    expect(ids(api)[0]).not.toBe('a99')
    expect(ids(api).slice(-2)).toEqual([
      a(sec(lastA) - 1).id,
      a(sec(lastA) - 2).id,
    ])
  })

  it('取得に失敗したアカウントはバックオフし、その間は追加読み込みが何も取らない', async () => {
    addAccount('acc-a')
    addAccount('acc-b')
    let failA = false
    const rec = recorder({
      'acc-a': (u) => {
        if (u && failA) throw new Error('boom')
        return u ? [note('a35')] : [note('a50'), note('a40')]
      },
      'acc-b': () => [note('b30'), note('b10')],
    })
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({
      column,
      paging: 'horizon',
      fetchFor: rec.fetchFor,
    })
    await flush()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(100_000)
    failA = true
    await api.loadMoreCrossAccount()
    await flush()
    expect(ids(api)).toEqual(['a50', 'a40'])
    const callsBefore = rec.calls.length
    // バックオフ中 (1 秒): 水平線のアカウントが取れないので何も取らない (acc-b で底を掘らない)
    now.mockReturnValue(100_500)
    await api.loadMoreCrossAccount()
    await flush()
    expect(rec.calls.length).toBe(callsBefore)
    // バックオフが明けたら再試行する
    failA = false
    now.mockReturnValue(101_100)
    await api.loadMoreCrossAccount()
    await flush()
    expect(ids(api)).toEqual(['a50', 'a40', 'a35'])
    now.mockRestore()
  })

  it('復帰の取り直しで到達点が新しくなっても水平線は上げない (既表示行を隠さない)', async () => {
    addAccount('acc-a')
    addAccount('acc-b')
    let resumed = false
    const rec = recorder({
      'acc-a': (u) =>
        u
          ? u === 'a80'
            ? [note('a70')]
            : []
          : resumed
            ? [note('a90'), note('a80')]
            : [note('a50'), note('a40')],
      'acc-b': () => [note('b30'), note('b10')],
    })
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({
      column,
      paging: 'horizon',
      streaming: true,
      fetchFor: rec.fetchFor,
    })
    await flushFrames()
    expect(ids(api)).toEqual(['a50', 'a40'])
    resumed = true
    await api.pullRefresh()
    await flushFrames()
    // acc-a は gap で置換され、到達点は a80。水平線は a40 のままなので b30 はまだ隠れる
    expect(ids(api)).toEqual(['a90', 'a80'])
    await api.loadMoreCrossAccount()
    await flushFrames()
    expect(rec.calls.at(-1)).toEqual({ id: 'acc-a', untilId: 'a80' })
    expect(ids(api)).toEqual(['a90', 'a80', 'a70'])
  })

  it('起動時、最新ページと重ならないアカウントのキャッシュは落とす (per-account と同じ gap 判定)', async () => {
    addAccount('acc-a')
    addAccount('acc-b')
    // acc-a は最新ページ (a50, a40) とキャッシュ (a20, a10) が重ならない = 間に穴
    // acc-b は最新ページ (b30, b25) にキャッシュの b30 が含まれる = 続いている
    bindings.responses.apiGetCachedTimeline = (accountId: string) =>
      accountId === 'acc-a'
        ? [stamp(note('a20'), 'acc-a'), stamp(note('a10'), 'acc-a')]
        : [stamp(note('b30'), 'acc-b'), stamp(note('b08'), 'acc-b')]
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({
      column,
      paging: 'horizon',
      fetchFor: (id) =>
        id === 'acc-a'
          ? [note('a50'), note('a40')]
          : [note('b30'), note('b25')],
    })
    await flush()
    expect(ids(api)).toEqual(['a50', 'a40'])
    expect(api.hiddenGroups.value.map((g) => g.primary.id)).toEqual([
      'b30',
      'b25',
      'b08',
    ])
  })

  it('水平線を使わない面 (お気に入り等) は従来どおり全アカウントを到着順に遡る', async () => {
    addAccount('acc-a')
    addAccount('acc-b')
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({
      column,
      fetchFor: (id, o) => {
        if (id === 'acc-a') {
          return o?.untilId
            ? [note('a35'), note('a33')]
            : [note('a50'), note('a40')]
        }
        return o?.untilId ? [note('b05')] : [note('b30'), note('b10')]
      },
    })
    await flush()
    expect(ids(api)).toEqual(['a50', 'a40', 'b30', 'b10'])
    await api.loadMoreCrossAccount()
    await flush()
    expect(ids(api)).toEqual(['a50', 'a40', 'a35', 'a33', 'b30', 'b10', 'b05'])
  })
})

describe('useCrossAccountNotes: streaming と Pull to Refresh', () => {
  it('streaming の新着にも組込フィルタ + クエリを通す', async () => {
    seedQuery('q-fast', 'note.text != null && note.text.incl("keep")')
    addAccount('acc-a')
    const column = ref<Partial<DeckColumn>>({
      noteQueryRefs: ['q-fast'],
      filters: { withReplies: false },
    })
    const { api, live } = mountCross({
      column,
      fetchFor: () => [note('a01', { text: 'keep' } as never)],
      streaming: true,
    })
    await flush()
    const stream = live.get('acc-a')
    expect(stream).toBeDefined()
    stream?.enqueue(note('a10', { text: 'keep new' } as never))
    stream?.enqueue(note('a11', { text: 'drop new' } as never))
    stream?.enqueue(
      note('a12', { text: 'keep reply', reply: { id: 'x' } } as never),
    )
    await flushFrames()
    expect(ids(api)).toEqual(['a10', 'a01'])
  })

  it('Pull to Refresh は列があれば catch-up、無ければ取り直す', async () => {
    addAccount('acc-a')
    let page = [note('a01')]
    const fetchFor = vi.fn(() => page)
    const column = ref<Partial<DeckColumn>>({})
    const { api } = mountCross({ column, fetchFor, streaming: true })
    await flush()
    expect(ids(api)).toEqual(['a01'])
    const before = fetchFor.mock.calls.length

    page = [note('a02'), note('a01')]
    await api.pullRefresh()
    await flushFrames()
    expect(fetchFor.mock.calls.length).toBeGreaterThan(before)
    expect(ids(api)).toEqual(['a02', 'a01'])
  })

  it('復帰で取り直した既存ノートも判定を通し、合致しなくなったものは表示から外す (#1120)', async () => {
    addAccount('acc-a')
    let page = [note('a02', { text: 'keep' }), note('a01', { text: 'keep' })]
    const fetchFor = vi.fn(() => page)
    const column = ref<Partial<DeckColumn>>({
      noteQuery: 'note.text != "drop"',
    })
    const { api } = mountCross({ column, fetchFor, streaming: true })
    await flush()
    expect(ids(api)).toEqual(['a02', 'a01'])

    // 切断中に a02 の本文が編集されてクエリから外れた。a01 は重なるので gap ではない
    page = [note('a02', { text: 'drop' }), note('a01', { text: 'keep' })]
    await api.pullRefresh()
    await flushFrames()
    expect(ids(api)).toEqual(['a01'])
  })
})

describe('useCrossAccountNotes: ノートアクションは取得元アカウントで実行する', () => {
  function mountOne() {
    addAccount('acc-a')
    const apiA = seedAdapter('acc-a')
    const mounted = mountCross({
      column: ref<Partial<DeckColumn>>({}),
      fetchFor: (accountId) => (accountId === 'acc-a' ? [note('a01')] : []),
    })
    return { ...mounted, apiA }
  }
  const keyA = variantKey('acc-a', 'a01')
  function first(api: ReturnType<typeof useCrossAccountNotes>): NormalizedNote {
    const n = api.notes.value[0]
    if (!n) throw new Error('list is empty')
    return n
  }

  it('リノートすると取得元アカウントの adapter で createNote し、renoteCount を楽観更新する', async () => {
    const { api, handlers, apiA } = mountOne()
    await flush()
    await handlers.renote(first(api))
    expect(apiA.createNote).toHaveBeenCalledWith({ renoteId: 'a01' })
    expect(useNoteStore().get(keyA)?.renoteCount).toBe(1)
  })

  it('ブックマークすると取得元アカウントの adapter で createFavorite する', async () => {
    const { api, handlers, apiA } = mountOne()
    await flush()
    await handlers.bookmark(first(api))
    expect(apiA.createFavorite).toHaveBeenCalledWith('a01')
    expect(useNoteStore().get(keyA)?.isFavorited).toBe(true)
  })

  it('返信すると投稿フォームが取得元アカウント宛てに開く', async () => {
    const { api, handlers, postForm } = mountOne()
    await flush()
    handlers.reply(first(api))
    expect(postForm.show.value).toBe(true)
    expect(postForm.accountId.value).toBe('acc-a')
    expect(postForm.replyTo.value?.id).toBe('a01')
    postForm.close()
    expect(postForm.accountId.value).toBeUndefined()
  })

  it('ログアウト済みアカウントのノートは adapter を作らず toast で止める', async () => {
    const { handlers, postForm } = mountOne()
    addAccount('acc-b', 'other.example', false)
    await flush()
    await handlers.renote(stamp(note('b01'), 'acc-b'))
    expect(adapters.has('acc-b')).toBe(false)
    expect(
      vi.mocked(initAdapterFor).mock.calls.some((c) => c[1] === 'acc-b'),
    ).toBe(false)
    expect(useToast().toasts.value).toHaveLength(1)
    // 返信 (キーボード経路) も同じ判定で止まり、フォームは開かない
    handlers.reply(stamp(note('b02'), 'acc-b'))
    expect(postForm.show.value).toBe(false)
  })

  it('削除は取得元アカウントで deleteNote し、tombstone と SQLite キャッシュ削除まで行う', async () => {
    const { api, handlers, apiA } = mountOne()
    await flush()
    await expect(handlers.delete(first(api))).resolves.toBe(true)
    expect(apiA.deleteNote).toHaveBeenCalledWith('a01')
    expect(useNoteStore().isDeleted(keyA)).toBe(true)
    expect(
      bindings.calls.some(
        (c) => c.name === 'apiDeleteCachedNote' && c.args[1] === 'a01',
      ),
    ).toBe(true)
  })

  it('削除して編集は削除後に行を tombstone 化してフォームを開く', async () => {
    const { api, handlers, postForm, apiA } = mountOne()
    await flush()
    await expect(handlers.deleteAndEdit(first(api))).resolves.toBe(true)
    expect(apiA.deleteNote).toHaveBeenCalledWith('a01')
    expect(useNoteStore().get(keyA)).toBeUndefined()
    expect(
      bindings.calls.some(
        (c) => c.name === 'apiDeleteCachedNote' && c.args[1] === 'a01',
      ),
    ).toBe(true)
    expect(postForm.show.value).toBe(true)
    expect(postForm.accountId.value).toBe('acc-a')
    expect(postForm.initialNote.value?.id).toBe('a01')
  })

  it('adapter の生成に失敗したら false を返して toast を出す (無言で終わらない)', async () => {
    const { api, handlers } = mountOne()
    await flush()
    const target = first(api)
    adapters.delete('acc-a')
    vi.mocked(initAdapterFor).mockRejectedValueOnce(new Error('offline'))
    await expect(handlers.delete(target)).resolves.toBe(false)
    expect(useToast().toasts.value).toHaveLength(1)
  })

  it('削除して編集は削除に失敗したら false を返し、行もフォームも触らない', async () => {
    const { api, handlers, postForm, apiA } = mountOne()
    await flush()
    apiA.deleteNote.mockRejectedValueOnce(new Error('boom'))
    await expect(handlers.deleteAndEdit(first(api))).resolves.toBe(false)
    expect(useNoteStore().get(keyA)).toBeDefined()
    expect(postForm.show.value).toBe(false)
  })
})

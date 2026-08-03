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
import type {
  NormalizedNote,
  ServerAdapter,
  TimelineFilter,
} from '@/adapters/types'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { type DeckColumn, useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import { matchesFilter } from '@/utils/timelineFilter'
import { type NoteColumnConfig, useNoteColumn } from './useNoteColumn'

// tauri-specta bindings: 全コマンドを空成功で応答（SQLite キャッシュは空扱い）。
// 呼び出しは記録し、キャッシュ系アサーションで参照する
const bindings = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
  /** コマンド名ごとの応答。未設定なら空配列 (既存テストの既定) */
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
          const data = bindings.responses[name] ?? []
          return Promise.resolve({ status: 'ok', data })
        },
    },
  ),
}))

/**
 * 🐢 降格の runner を Worker 抜きで差し替える (#783 Phase 2c)。
 * 評価ロジックは本物 (degradedBatch) をそのまま同期実行するので、
 * カラム側の接続だけを検証できる。Worker 境界は degradedRunner.test.ts の担当。
 */
const degraded = vi.hoisted(() => ({
  suspended: new Set<string>(),
  runCalls: [] as { keys: string[]; noteCount: number }[],
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
      resume: (key: string) => degraded.suspended.delete(key),
      dispose: () => {
        // Worker を持たないので解放するものがない
      },
    }),
  }
})

const fakeStream = {
  connect: vi.fn(),
  reconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  subNote: vi.fn(),
  unsubNote: vi.fn(),
  cleanup: vi.fn(),
}
const fakeAdapter = { api: {}, stream: fakeStream } as unknown as ServerAdapter

vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async () => ({
    adapter: fakeAdapter,
    serverInfo: { iconUrl: '' },
  })),
}))

// happy-dom に AudioContext がないため、streaming カラムの通知音は無効化
vi.mock('@/composables/useNoteSound', () => ({
  useNoteSound: () => ({ play: vi.fn(), warmup: vi.fn() }),
}))

function note(id: string, visibility = 'public'): NormalizedNote {
  return {
    id,
    createdAt: `2026-07-01T00:00:${id.slice(-2).padStart(2, '0')}.000Z`,
    text: id,
    cw: null,
    visibility,
    user: { id: `user-${id}`, username: id, host: null },
    files: [],
    reactions: {},
  } as unknown as NormalizedNote
}

/**
 * マイクロタスクと nextTick を数周流して非同期チェーンを収束させる。
 * 取り込み経路が 🐢 降格 (#783 Phase 2) に対応して async になった分、
 * 収束に必要な周回が増えている (6 周では足りない)。
 */
async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

let apps: App[] = []
let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  bindings.calls.length = 0
  for (const k of Object.keys(bindings.responses)) delete bindings.responses[k]
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-01T12:00:00Z'))
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  for (const app of apps) app.unmount()
  apps = []
  vi.useRealTimers()
})

function addAccount(id: string) {
  useAccountsStore().accounts.push({
    id,
    host: 'example.com',
    userId: `uid-${id}`,
    username: id,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
  } as Account)
}

function mountColumn(opts: {
  accountId: string
  columnId?: string
  fetch: NoteColumnConfig['fetch']
  filterNotes?: NoteColumnConfig['filterNotes']
  fetchKey?: NoteColumnConfig['fetchKey']
  filters?: Ref<TimelineFilter | undefined>
  streaming?: boolean
  noteQuery?: string
  noteQueryRefs?: string[]
}) {
  const tlKey = ref('home')
  let api: ReturnType<typeof useNoteColumn> | null = null
  const Host = defineComponent({
    setup() {
      api = useNoteColumn({
        getColumn: () =>
          ({
            id: opts.columnId ?? `col-${opts.accountId}`,
            type: 'timeline',
            accountId: opts.accountId,
            filters: opts.filters?.value,
            noteQuery: opts.noteQuery,
            noteQueryRefs: opts.noteQueryRefs,
          }) as DeckColumn,
        fetch: opts.fetch,
        cache: { getKey: () => tlKey.value },
        filterNotes: opts.filterNotes,
        fetchKey: opts.fetchKey,
        streaming: opts.streaming
          ? { subscribe: () => ({ dispose: vi.fn() }) }
          : undefined,
      })
      return () => null
    },
  })
  const app = createApp(Host)
  app.use(pinia)
  app.mount(document.createElement('div'))
  apps.push(app)
  if (!api) throw new Error('harness setup failed')
  return { tlKey, api: api as ReturnType<typeof useNoteColumn> }
}

function ids(api: ReturnType<typeof useNoteColumn>): string[] {
  return api.notes.value.map((n) => n.id)
}

describe('useNoteColumn: 放置復帰の stale-tab ガードと REST 可視性フィルタ (#651)', () => {
  it('復帰フェッチ中にタブが切り替わったら旧タブの結果を破棄する', async () => {
    addAccount('acc-resume')
    let resolveResume: ((n: NormalizedNote[]) => void) | undefined
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h01')]) // mount 時 connect (home)
      .mockImplementationOnce(
        () =>
          new Promise<NormalizedNote[]>((r) => {
            resolveResume = r
          }),
      ) // 復帰時 catch-up (home, 未解決のまま保持)
    const { tlKey, api } = mountColumn({
      accountId: 'acc-resume',
      fetch: () => fetchImpl(),
    })
    await flush()
    expect(ids(api)).toEqual(['h01'])

    // dedup レスポンスキャッシュ (TTL 5s) を確実に失効させてから復帰
    vi.advanceTimersByTime(6000)
    useUiStore().emitDeckResume()
    await flush(2)
    expect(resolveResume).toBeDefined()

    // catch-up 未解決のうちにローカルタブへ切り替え（表示もローカルに差し替わる）
    tlKey.value = 'local'
    api.setNotes([note('l01')])

    // ホーム TL の遅延レスポンス到着 — 現在ノートと重なりゼロ → gap 置換経路
    resolveResume?.([note('h02'), note('h03')])
    await flush()

    // 旧タブの結果は破棄され、ローカルタブは汚染されない
    expect(ids(api)).toEqual(['l01'])
  })

  it('復帰フェッチ完了までタブが同じなら通常どおりマージされる', async () => {
    addAccount('acc-merge')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h01')])
      .mockResolvedValueOnce([note('h01'), note('h02')])
    const { api } = mountColumn({
      accountId: 'acc-merge',
      fetch: () => fetchImpl(),
    })
    await flush()
    expect(ids(api)).toEqual(['h01'])

    vi.advanceTimersByTime(6000)
    useUiStore().emitDeckResume()
    await flush()

    expect(ids(api)).toContain('h01')
    expect(ids(api)).toContain('h02')
  })

  it('reconnect(connect) 中にタブが切り替わったら旧タブの結果を破棄する', async () => {
    addAccount('acc-reconnect')
    let resolveReconnect: ((n: NormalizedNote[]) => void) | undefined
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h01')]) // mount 時 connect
      .mockImplementationOnce(
        () =>
          new Promise<NormalizedNote[]>((r) => {
            resolveReconnect = r
          }),
      ) // reconnect 経由の connect
    const { tlKey, api } = mountColumn({
      accountId: 'acc-reconnect',
      fetch: () => fetchImpl(),
    })
    await flush()
    expect(ids(api)).toEqual(['h01'])

    vi.advanceTimersByTime(6000)
    const done = api.reconnect()
    await flush(2)
    expect(resolveReconnect).toBeDefined()

    tlKey.value = 'local'
    api.setNotes([note('l01')])

    resolveReconnect?.([note('h02')])
    await done
    await flush()

    expect(ids(api)).toEqual(['l01'])
  })

  it('REST 取得結果にも可視性フィルタが適用される (local は public のみ)', async () => {
    addAccount('acc-filter')
    const fetchImpl = vi
      .fn()
      .mockResolvedValue([note('p01', 'public'), note('f02', 'followers')])
    const { api } = mountColumn({
      accountId: 'acc-filter',
      fetch: () => fetchImpl(),
      filterNotes: (notes) =>
        notes.filter((n) => matchesFilter(n, undefined, 'local')),
    })
    await flush()

    expect(ids(api)).toEqual(['p01'])
  })

  it('dedup キーがフィルタ指紋 (fetchKey) を含み、フィルタ違いのカラム間でレスポンスを共有しない', async () => {
    addAccount('acc-dedup')
    const fetchA = vi.fn().mockResolvedValue([note('a01')])
    const fetchB = vi.fn().mockResolvedValue([note('b01')])

    const colA = mountColumn({
      accountId: 'acc-dedup',
      columnId: 'col-a',
      fetch: () => fetchA(),
      fetchKey: () => JSON.stringify({}),
    })
    await flush()
    expect(ids(colA.api)).toEqual(['a01'])

    // 5 秒以内 (dedup TTL 内) に同一アカウント・同一 TL 種別で別フィルタのカラムを開く
    const colB = mountColumn({
      accountId: 'acc-dedup',
      columnId: 'col-b',
      fetch: () => fetchB(),
      fetchKey: () => JSON.stringify({ withFiles: true }),
    })
    await flush()

    expect(fetchB).toHaveBeenCalled()
    expect(ids(colB.api)).toEqual(['b01'])
  })
})

describe('useNoteColumn: 組込フィルタ (column.filters) の共通適用 (#841)', () => {
  /** renote のみ (引用でない) のノート */
  function renoteOnly(id: string): NormalizedNote {
    return {
      ...note(id),
      text: null,
      renote: note(`${id}-orig`),
    } as unknown as NormalizedNote
  }

  it('REST 取得結果に column.filters が適用される (withRenotes=false でリノート除外)', async () => {
    addAccount('acc-builtin')
    const fetchImpl = vi
      .fn()
      .mockResolvedValue([note('n01'), renoteOnly('r02')])
    const { api } = mountColumn({
      accountId: 'acc-builtin',
      fetch: () => fetchImpl(),
      filters: ref<TimelineFilter | undefined>({ withRenotes: false }),
    })
    await flush()

    expect(ids(api)).toEqual(['n01'])
  })

  it('filters の変更で表示中ノートに即時適用され、refetch も走る', async () => {
    addAccount('acc-builtin-toggle')
    const fetchImpl = vi
      .fn()
      .mockResolvedValue([note('n01'), renoteOnly('r02')])
    const filters = ref<TimelineFilter | undefined>(undefined)
    const { api } = mountColumn({
      accountId: 'acc-builtin-toggle',
      fetch: () => fetchImpl(),
      filters,
    })
    await flush()
    expect(ids(api)).toEqual(['n01', 'r02'])
    const fetchCountBefore = fetchImpl.mock.calls.length

    // 絞り込み方向: 表示中ノートから即時に落ちる + 緩和方向の回収用 refetch
    filters.value = { withRenotes: false }
    await flush()
    expect(ids(api)).toEqual(['n01'])
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(fetchCountBefore)

    // 緩和方向: フィルタ解除で refetch により復元される
    vi.advanceTimersByTime(6000) // dedup TTL を失効させる
    filters.value = undefined
    await flush()
    expect(ids(api)).toEqual(['n01', 'r02'])
  })
})

describe('useNoteColumn: スリープ復帰 catch-up とタブ切替の gap 検出 (#791)', () => {
  it('switchWithSnapshot: 最新ページが snapshot と重ならなければ置換する (gap)', async () => {
    addAccount('acc-tab-gap')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h01')]) // mount 時 connect
      .mockResolvedValueOnce([note('h11'), note('h10')]) // タブ切替の差分取得
    const { api } = mountColumn({
      accountId: 'acc-tab-gap',
      fetch: () => fetchImpl(),
      streaming: true,
    })
    await flush()
    expect(ids(api)).toEqual(['h01'])

    vi.advanceTimersByTime(6000)
    // 古い snapshot に復帰 — 最新ページと重なりゼロ = 1 ページ超の欠落
    await api.switchWithSnapshot([note('h01')], 0)
    await flush()

    // sinceId マージで穴を残さず、最新ページで丸ごと置換される
    expect(ids(api)).toEqual(['h11', 'h10'])
  })

  it('switchWithSnapshot: スクロール中の小差分はバナーに留め、自動で最上部へ戻さない', async () => {
    addAccount('acc-tab-merge')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h01')]) // mount 時 connect
      .mockResolvedValueOnce([note('h02'), note('h01')]) // タブ切替の差分取得 (重なりあり)
    const { api } = mountColumn({
      accountId: 'acc-tab-merge',
      fetch: () => fetchImpl(),
      streaming: true,
    })
    await flush()
    expect(ids(api)).toEqual(['h01'])

    vi.advanceTimersByTime(6000)
    // scrollTop 500 = 最上部にいない状態でタブ復帰
    await api.switchWithSnapshot([note('h01')], 500)
    await flush()

    // 表示は維持し、新着はバナー (pendingCount) 経由でのみ反映
    expect(ids(api)).toEqual(['h01'])
    expect(api.pendingCount.value).toBe(1)
  })

  it('streaming カラムでもリロードボタン (refresh) が catch-up を実行する', async () => {
    addAccount('acc-refresh')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h01')]) // mount 時 connect
      .mockResolvedValueOnce([note('h11'), note('h10')]) // refresh の catch-up
    const { api } = mountColumn({
      accountId: 'acc-refresh',
      fetch: () => fetchImpl(),
      streaming: true,
    })
    await flush()
    expect(ids(api)).toEqual(['h01'])

    vi.advanceTimersByTime(6000)
    await api.refresh()
    await flush()

    // no-op ではなく最新ページを取得し、gap なら置換される
    expect(ids(api)).toEqual(['h11', 'h10'])
  })
})

describe('useNoteColumn: フェッチカーソル (#831 Step 0)', () => {
  it('生ページが全件フィルタ落ちでも loadMore が前進する (API 経路)', async () => {
    addAccount('acc-cursor-api')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h05'), note('h04')]) // 初回ページ (全件却下)
      .mockResolvedValueOnce([])
    const { api } = mountColumn({
      accountId: 'acc-cursor-api',
      fetch: (_a, opts) => fetchImpl(opts),
      filterNotes: () => [],
    })
    await flush()
    expect(ids(api)).toEqual([])

    await api.loadMore()
    await flush()

    // バッファ末尾基準だと空ガードで止まり、同じページを取り続ける。
    // カーソルは落ちたノートを含めて前進するので続きを取りに行ける
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1]?.[0]).toEqual({ untilId: 'h04' })
  })

  it('オフライン fallback のキャッシュ経路もカーソルの createdAt でアンカーする', async () => {
    addAccount('acc-cursor-cache')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h05'), note('h04')]) // 初回ページ (全件却下)
      .mockRejectedValueOnce(new Error('offline'))
    const { api } = mountColumn({
      accountId: 'acc-cursor-cache',
      fetch: () => fetchImpl(),
      filterNotes: () => [],
    })
    await flush()

    await api.loadMore()
    await flush()

    const before = bindings.calls.find(
      (c) => c.name === 'apiGetCachedTimelineBefore',
    )
    expect(before?.args[2]).toBe(note('h04').createdAt)
  })

  it('reconnect でカーソルがリセットされ、旧世代の位置から取り直さない', async () => {
    addAccount('acc-cursor-reset')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h05'), note('h04')]) // mount 時 connect
      .mockResolvedValueOnce([note('h03')]) // loadMore
      .mockResolvedValueOnce([note('h09')]) // reconnect (gap → 置換)
      .mockResolvedValueOnce([])
    const { api } = mountColumn({
      accountId: 'acc-cursor-reset',
      fetch: (_a, opts) => fetchImpl(opts),
    })
    await flush()

    await api.loadMore()
    await flush()
    expect(fetchImpl.mock.calls[1]?.[0]).toEqual({ untilId: 'h04' })

    vi.advanceTimersByTime(6000) // dedup TTL 失効
    await api.reconnect()
    await flush()
    expect(ids(api)).toEqual(['h09'])

    await api.loadMore()
    await flush()

    // 旧カーソル (h03) が残っていると h09 と h03 の間がスキップされる
    expect(fetchImpl.mock.calls[3]?.[0]).toEqual({ untilId: 'h09' })
  })
})

describe('useNoteColumn: 🐢 逐次適用への降格 (#783 Phase 2c)', () => {
  // str.len は QIR サブセット外だが純粋なので Worker 逐次適用に降格する
  const SLOW_QUERY = 'note.text != null && note.text.len > 3'

  beforeEach(() => {
    degraded.suspended.clear()
    degraded.runCalls.length = 0
  })

  it('降格クエリを持つカラムは status が degraded になる', async () => {
    addAccount('acc-slow')
    const { api } = mountColumn({
      accountId: 'acc-slow',
      noteQuery: SLOW_QUERY,
      fetch: async () => [],
    })
    await flush()
    expect(api.columnQueryState.value.status).toBe('degraded')
  })

  it('REST 取得結果に降格クエリが適用される', async () => {
    addAccount('acc-slow-rest')
    const { api } = mountColumn({
      accountId: 'acc-slow-rest',
      noteQuery: SLOW_QUERY,
      fetch: async () => [
        { ...note('long'), text: 'hello world' } as NormalizedNote,
        { ...note('short'), text: 'hi' } as NormalizedNote,
      ],
    })
    await flush()
    expect(ids(api)).toEqual(['long'])
    expect(degraded.runCalls.length).toBeGreaterThan(0)
  })

  it('除外したノートを診断に計上する', async () => {
    addAccount('acc-slow-count')
    const { api } = mountColumn({
      accountId: 'acc-slow-count',
      noteQuery: SLOW_QUERY,
      fetch: async () => [
        { ...note('long'), text: 'hello world' } as NormalizedNote,
        { ...note('short'), text: 'hi' } as NormalizedNote,
      ],
    })
    await flush()
    expect(api.columnQueryExcludedCount.value).toBeGreaterThan(0)
  })

  it('サスペンド中のクエリは fail-closed (全件除外)', async () => {
    addAccount('acc-slow-susp')
    degraded.suspended.add('col-acc-slow-susp:inline')
    const { api } = mountColumn({
      accountId: 'acc-slow-susp',
      noteQuery: SLOW_QUERY,
      fetch: async () => [
        { ...note('long'), text: 'hello world' } as NormalizedNote,
      ],
    })
    await flush()
    expect(ids(api)).toEqual([])
    expect(api.columnQuerySuspendedKeys.value).toEqual([
      'col-acc-slow-susp:inline',
    ])
  })

  it('⚡ だけのカラムでは Worker 経路を通らない', async () => {
    addAccount('acc-fast')
    const { api } = mountColumn({
      accountId: 'acc-fast',
      // QIR にコンパイルできる = ⚡
      noteQuery: 'note.text != null',
      fetch: async () => [
        { ...note('a'), text: 'x' } as NormalizedNote,
        { ...note('b'), text: null } as NormalizedNote,
      ],
    })
    await flush()
    expect(ids(api)).toEqual(['a'])
    expect(api.columnQueryState.value.status).toBe('active')
    expect(degraded.runCalls).toEqual([])
  })

  it('サスペンド中に取りこぼした件数を保留として数える', async () => {
    addAccount('acc-slow-hold')
    degraded.suspended.add('col-acc-slow-hold:inline')
    const { api } = mountColumn({
      accountId: 'acc-slow-hold',
      noteQuery: SLOW_QUERY,
      fetch: async () => [
        { ...note('a'), text: 'hello world' } as NormalizedNote,
        { ...note('b'), text: 'hello there' } as NormalizedNote,
      ],
    })
    await flush()
    expect(api.columnQuerySuspendedCount.value).toBe(2)
  })

  it('明示再開でサスペンドを解除し、取り込みが戻る', async () => {
    addAccount('acc-slow-resume')
    degraded.suspended.add('col-acc-slow-resume:inline')
    const { api } = mountColumn({
      accountId: 'acc-slow-resume',
      noteQuery: SLOW_QUERY,
      fetch: async () => [
        { ...note('long'), text: 'hello world' } as NormalizedNote,
      ],
    })
    await flush()
    expect(ids(api)).toEqual([])

    api.resumeSuspendedQueries()
    await flush()
    expect(api.columnQuerySuspendedKeys.value).toEqual([])
    expect(api.columnQuerySuspendedCount.value).toBe(0)
    expect(ids(api)).toEqual(['long'])
  })

  it('拒否されたクエリ (非純粋) は降格せず fail-closed のまま', async () => {
    addAccount('acc-reject')
    const { api } = mountColumn({
      accountId: 'acc-reject',
      noteQuery: 'Date:now() > 0',
      fetch: async () => [{ ...note('a'), text: 'x' } as NormalizedNote],
    })
    await flush()
    expect(api.columnQueryState.value.status).toBe('invalid')
    expect(ids(api)).toEqual([])
    expect(degraded.runCalls).toEqual([])
  })
})

describe('useNoteColumn: QIR キャッシュ検索 (#783 Phase 3)', () => {
  const FAST_QUERY = 'note.text != null'
  const SLOW_QUERY = 'note.text != null && note.text.len > 3'

  const searchCalls = () =>
    bindings.calls.filter((c) => c.name === 'qirSearchCache')
  const legacyCalls = () =>
    bindings.calls.filter((c) => c.name === 'apiGetCachedTimelineBefore')

  /**
   * オフライン fallback でキャッシュ経路に入らせる。
   * dedup レスポンスキャッシュ (TTL 5s) を跨がないよう accountId は毎回変える
   */
  async function mountOfflineColumn(
    accountId: string,
    noteQuery: string | undefined,
  ) {
    addAccount(accountId)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([{ ...note('h05'), text: 'hello' }])
      .mockRejectedValueOnce(new Error('offline'))
    const { api } = mountColumn({
      accountId,
      noteQuery,
      fetch: () => fetchImpl(),
    })
    await flush()
    await api.loadMore()
    await flush()
    return api
  }

  it('⚡ クエリのカラムはキャッシュ検索コマンドを使う', async () => {
    bindings.responses.qirSearchCache = {
      notes: [],
      scanned: 0,
      errors: 0,
      cursor: null,
    }
    await mountOfflineColumn('acc-search-fast', FAST_QUERY)
    expect(searchCalls()).toHaveLength(1)
    expect(legacyCalls()).toHaveLength(0)
  })

  it('クエリが無いカラムは従来のキャッシュ経路のまま', async () => {
    await mountOfflineColumn('acc-search-none', undefined)
    expect(searchCalls()).toHaveLength(0)
    expect(legacyCalls()).toHaveLength(1)
  })

  it('🐢 降格クエリは QIR を持たないので従来経路', async () => {
    await mountOfflineColumn('acc-search-slow', SLOW_QUERY)
    expect(searchCalls()).toHaveLength(0)
    expect(legacyCalls()).toHaveLength(1)
  })

  it('見つかったノートを取り込み、打ち切りカーソルから次を続ける', async () => {
    bindings.responses.qirSearchCache = {
      notes: [{ ...note('h01'), text: 'hit' }],
      scanned: 2000,
      errors: 3,
      // 走査上限で打ち切り
      cursor: { createdAt: '2026-06-30T00:00:00.000Z', noteId: 'h00' },
    }
    const api = await mountOfflineColumn('acc-search-cursor', FAST_QUERY)
    expect(ids(api)).toContain('h01')
    // per-note エラーは診断に積まれる
    expect(api.columnQueryErrorCount.value).toBeGreaterThanOrEqual(3)

    // 次の loadMore は打ち切り位置から続ける
    await api.loadMore()
    await flush()
    const second = searchCalls()[1]
    expect(second?.args[4]).toEqual({
      createdAt: '2026-06-30T00:00:00.000Z',
      noteId: 'h00',
    })
  })
})

describe('useNoteColumn: 消えたクエリ参照からの復旧 (#783 追補 A)', () => {
  it('参照先が無いクエリは fail-closed のまま id を露出する', async () => {
    addAccount('acc-missing-ref')
    const { api } = mountColumn({
      accountId: 'acc-missing-ref',
      columnId: 'col-missing',
      noteQueryRefs: ['deleted-query'],
      fetch: async () => [{ ...note('a'), text: 'x' } as NormalizedNote],
    })
    await flush()
    // 参照が消えても勝手に外さない (再導入で戻せるように)
    expect(api.columnQueryMissingIds.value).toEqual(['deleted-query'])
    expect(api.columnQueryState.value.status).toBe('invalid')
    expect(ids(api)).toEqual([])
  })

  it('参照を外すとカラム設定から取り除かれる', async () => {
    addAccount('acc-drop-ref')
    const deck = useDeckStore()
    const updates: unknown[] = []
    vi.spyOn(deck, 'updateColumn').mockImplementation((_id, patch) => {
      updates.push(patch)
    })
    const { api } = mountColumn({
      accountId: 'acc-drop-ref',
      columnId: 'col-drop',
      noteQueryRefs: ['deleted-query', 'another-deleted'],
      fetch: async () => [],
    })
    await flush()

    api.dropMissingQueryRefs()
    expect(updates).toEqual([{ noteQueryRefs: undefined }])
  })
})

describe('useNoteColumn: クエリ変更時の再適用と refetch の順序 (#783)', () => {
  it('クエリを外したら refetch の結果が残る (再適用に上書きされない)', async () => {
    addAccount('acc-query-toggle')
    const column = ref<Partial<DeckColumn>>({
      noteQuery: 'note.text == "none"',
    })
    const fetchImpl = vi
      .fn()
      .mockResolvedValue([
        { ...note('h01'), text: 'hello' } as NormalizedNote,
        { ...note('h02'), text: 'world' } as NormalizedNote,
      ])
    let api: ReturnType<typeof useNoteColumn> | null = null
    const Host = defineComponent({
      setup() {
        api = useNoteColumn({
          getColumn: () =>
            ({
              id: 'col-query-toggle',
              type: 'timeline',
              accountId: 'acc-query-toggle',
              ...column.value,
            }) as DeckColumn,
          fetch: () => fetchImpl(),
          cache: { getKey: () => 'home' },
        })
        return () => null
      },
    })
    const app = createApp(Host)
    app.use(pinia)
    app.mount(document.createElement('div'))
    apps.push(app)
    await flush()
    // 全件フィルタ落ちで空
    expect(ids(api as never)).toEqual([])

    // クエリを外す → 再適用 (空のまま) と refetch が走る
    column.value = {}
    await flush(20)

    // refetch の結果が残っていること (空で上書きされない)。
    // 並びは fetch の返却順そのまま (既存挙動)
    expect(ids(api as never)).toEqual(['h01', 'h02'])
  })
})

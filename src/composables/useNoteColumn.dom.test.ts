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
  NoteUpdateEvent,
  ServerAdapter,
  TimelineFilter,
} from '@/adapters/types'
import { type Account, useAccountsStore } from '@/stores/accounts'
import {
  type NamedQueryMeta,
  useColumnQueriesStore,
} from '@/stores/columnQueries'
import { type DeckColumn, useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import { matchesFilter } from '@/utils/timelineFilter'
import type { FramePriority } from './useFrameScheduler'
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

// streaming batch の flush は frameEngine の RAF ループに乗る。テストではループが
// 起動していないので、streaming 取り込みを見るテストだけ scheduler をマイクロ
// タスク実行に差し替える (常時差し替えると既存テストのタイミングが変わる)
const frameScheduler = vi.hoisted(() => ({ immediate: false }))
vi.mock('@/composables/useFrameScheduler', async () => {
  const actual = await vi.importActual<
    typeof import('@/composables/useFrameScheduler')
  >('@/composables/useFrameScheduler')
  return {
    ...actual,
    useFrameScheduler: () => {
      const real = actual.useFrameScheduler()
      return {
        ...real,
        schedule: (fn: () => void, priority: FramePriority) =>
          frameScheduler.immediate
            ? queueMicrotask(fn)
            : real.schedule(fn, priority),
      }
    },
  }
})

/**
 * 🐢 降格の runner を Worker 抜きで差し替える (#783 Phase 2c)。
 * 評価ロジックは本物 (degradedBatch) をそのまま同期実行するので、
 * カラム側の接続だけを検証できる。Worker 境界は degradedRunner.test.ts の担当。
 */
const degraded = vi.hoisted(() => ({
  suspended: new Set<string>(),
  runCalls: [] as { keys: string[]; noteCount: number }[],
  /** 設定中は Worker 応答をこの Promise が解決するまで止める (#1119 の再現用) */
  gate: null as Promise<void> | null,
  listeners: new Set<() => void>(),
  notify() {
    for (const l of this.listeners) l()
  },
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
        if (degraded.gate) await degraded.gate
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
        degraded.notify()
      },
      subscribe: (listener: () => void) => {
        degraded.listeners.add(listener)
        return () => degraded.listeners.delete(listener)
      },
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
  // VerifyNotesResult 形 (空配列既定では missing の for-of が throw する)
  bindings.responses.apiVerifyNotes = { verified: {}, missing: [] }
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

  it('復帰で取り直した既存ノートも判定を通し、合致しなくなったものは表示から外す (#1120)', async () => {
    addAccount('acc-resume-reeval')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([
        { ...note('h01'), text: 'keep' },
        { ...note('h02'), text: 'keep' },
      ])
      // 切断中に h01 の本文が編集されてクエリから外れた。h02 は重なるので gap ではない
      .mockResolvedValueOnce([
        { ...note('h01'), text: 'drop' },
        { ...note('h02'), text: 'keep' },
      ])
    const { api } = mountColumn({
      accountId: 'acc-resume-reeval',
      noteQuery: 'note.text != "drop"',
      fetch: () => fetchImpl(),
      streaming: true,
    })
    await flush()
    expect(ids(api)).toEqual(['h01', 'h02'])

    vi.advanceTimersByTime(6000)
    useUiStore().emitDeckResume()
    await flush()

    expect(ids(api)).toEqual(['h02'])
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

  it('switchWithSnapshot: 取り直しで合致しなくなった snapshot のノートを外す (#1120)', async () => {
    addAccount('acc-snap-reeval')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([{ ...note('h01'), text: 'keep' }])
      .mockResolvedValueOnce([
        { ...note('h01'), text: 'drop' },
        { ...note('h00'), text: 'keep' },
      ])
    const { api } = mountColumn({
      accountId: 'acc-snap-reeval',
      noteQuery: 'note.text != "drop"',
      fetch: () => fetchImpl(),
      streaming: true,
    })
    await flush()
    expect(ids(api)).toEqual(['h01'])

    vi.advanceTimersByTime(6000)
    // snapshot は編集前の h01。取り直しで h01 が外れ、h00 が残る (h00 が重なるので gap ではない)
    await api.switchWithSnapshot(
      [
        { ...note('h01'), text: 'keep' },
        { ...note('h00'), text: 'keep' },
      ],
      0,
    )
    await flush()
    expect(ids(api)).toEqual(['h00'])
  })

  it('switchWithSnapshot: snapshot にもカラムクエリを適用する', async () => {
    addAccount('acc-tab-query')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([{ ...note('keep'), text: 'x' }])
      // タブ切替の差分取得: snapshot と重なるので merge 経路 (置換されない)
      .mockResolvedValueOnce([{ ...note('keep'), text: 'x' }])
    const { api } = mountColumn({
      accountId: 'acc-tab-query',
      noteQuery: 'note.text != null',
      fetch: () => fetchImpl(),
      streaming: true,
    })
    await flush()
    expect(ids(api)).toEqual(['keep'])

    vi.advanceTimersByTime(6000)
    // snapshot に「クエリで除外されるべきノート」が混ざっている状態から復帰する
    await api.switchWithSnapshot(
      [
        { ...note('keep'), text: 'x' } as NormalizedNote,
        { ...note('drop'), text: null } as NormalizedNote,
      ],
      0,
    )
    await flush()

    expect(ids(api)).toEqual(['keep'])
  })

  it('switchWithSnapshot: snapshot のフィルタが落ちても列を出さず、取得は続ける', async () => {
    addAccount('acc-tab-filter-fail')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([note('h01')])
      .mockResolvedValueOnce([note('h02')])
    const { api } = mountColumn({
      accountId: 'acc-tab-filter-fail',
      fetch: () => fetchImpl(),
      // snapshot にだけ含まれるノートで落ちるフィルタ
      filterNotes: async (ns) => {
        if (ns.some((n) => n.id === 'poison')) throw new Error('filter boom')
        return ns
      },
      streaming: true,
    })
    await flush()

    vi.advanceTimersByTime(6000)
    // 呼び出し元 (onTabChange) は await していないので reject させない
    await expect(
      api.switchWithSnapshot([note('poison')], 0),
    ).resolves.toBeUndefined()
    await flush()

    // フィルタを通せない列は出さない (出すと隠したはずのノートが見える)
    expect(ids(api)).not.toContain('poison')
    // 取得自体は続き、最新ページは反映される
    expect(ids(api)).toContain('h02')
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
    // keyset cursor は createdAt と同一ノート由来の note_id をペアで渡す (§6-14)
    expect(before?.args[3]).toBe('h04')
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
    // カラムの所属バケットで母集合を絞る (notecli#30 §12-9)
    expect(searchCalls()[0]?.args[2]).toBe('home')
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

  it('⚡ 2 個 (インライン + 名前付き) でもキャッシュ検索コマンドを使う (#965)', async () => {
    bindings.responses.qirSearchCache = {
      notes: [],
      scanned: 0,
      errors: 0,
      cursor: null,
    }
    // 名前付きクエリをプールに登録 (ensureLoaded 後でないと push が上書きされる)
    const queriesStore = useColumnQueriesStore()
    queriesStore.ensureLoaded()
    queriesStore.queries.push({
      id: 'q-vis-965',
      name: 'public only',
      src: 'note.visibility == "public"',
      createdAt: 0,
      updatedAt: 0,
    })
    addAccount('acc-search-multi')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([{ ...note('h05'), text: 'hello' }])
      .mockRejectedValueOnce(new Error('offline'))
    const { api } = mountColumn({
      accountId: 'acc-search-multi',
      noteQuery: FAST_QUERY,
      noteQueryRefs: ['q-vis-965'],
      fetch: () => fetchImpl(),
    })
    await flush()
    await api.loadMore()
    await flush()

    // 従来は複数パーツで黙って従来経路に落ちていた (#965 で And 合成)
    expect(searchCalls()).toHaveLength(1)
    expect(legacyCalls()).toHaveLength(0)
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
    expect(second?.args[5]).toEqual({
      createdAt: '2026-06-30T00:00:00.000Z',
      noteId: 'h00',
    })
  })
})

describe('useNoteColumn: オンライン loadMore のキャッシュ検索チェーン (#964)', () => {
  const FAST_QUERY = 'note.text != null'

  const searchCalls = () =>
    bindings.calls.filter((c) => c.name === 'qirSearchCache')

  it('API ページが全件フィルタ落ちならキャッシュ検索を 1 パスだけチェーンする', async () => {
    bindings.responses.qirSearchCache = {
      notes: [{ ...note('c01'), text: 'cached hit' }],
      scanned: 100,
      errors: 0,
      cursor: null,
    }
    addAccount('acc-chain-empty')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([{ ...note('h05'), text: 'hello' }]) // connect
      .mockResolvedValueOnce([
        { ...note('h04'), text: null },
        { ...note('h03'), text: null },
      ]) // loadMore: 全件クエリ落ち
    const { api } = mountColumn({
      accountId: 'acc-chain-empty',
      noteQuery: FAST_QUERY,
      fetch: () => fetchImpl(),
    })
    await flush()
    expect(ids(api)).toEqual(['h05'])

    await api.loadMore()
    await flush()

    // オンラインのままキャッシュ検索が 1 回だけ走り、ヒットがカラムに載る
    expect(searchCalls()).toHaveLength(1)
    expect(ids(api)).toContain('c01')
    expect(api.isOffline.value).toBe(false)
    // 検索は API が前進させたカーソル (生ページの最古 h03) より古い側を走査
    expect(searchCalls()[0]?.args[5]).toEqual({
      createdAt: note('h03').createdAt,
      noteId: 'h03',
    })
  })

  it('フィルタ通過ノートが 1 件でもあればチェーンしない', async () => {
    addAccount('acc-chain-skip')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([{ ...note('h05'), text: 'hello' }]) // connect
      .mockResolvedValueOnce([
        { ...note('h04'), text: 'world' },
        { ...note('h03'), text: null },
      ]) // loadMore: 1 件は通過
    const { api } = mountColumn({
      accountId: 'acc-chain-skip',
      noteQuery: FAST_QUERY,
      fetch: () => fetchImpl(),
    })
    await flush()

    await api.loadMore()
    await flush()

    expect(searchCalls()).toHaveLength(0)
    expect(ids(api)).toEqual(['h05', 'h04'])
  })

  it('チェーンで得た打ち切りカーソルが次回 loadMore に引き継がれる', async () => {
    bindings.responses.qirSearchCache = {
      notes: [{ ...note('c02'), text: 'cached hit' }],
      scanned: 2000,
      errors: 0,
      // 走査上限で打ち切り
      cursor: { createdAt: '2026-06-30T00:00:00.000Z', noteId: 'c00' },
    }
    addAccount('acc-chain-cursor')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([{ ...note('h05'), text: 'hello' }]) // connect
      .mockResolvedValueOnce([{ ...note('h04'), text: null }]) // loadMore: 全落ち → チェーン
      .mockResolvedValueOnce([]) // 次の loadMore
    const { api } = mountColumn({
      accountId: 'acc-chain-cursor',
      noteQuery: FAST_QUERY,
      fetch: (_a, opts) => fetchImpl(opts),
    })
    await flush()

    await api.loadMore()
    await flush()
    expect(searchCalls()).toHaveLength(1)

    await api.loadMore()
    await flush()

    // チェーンが前進させたカーソル (c00) から続きを取りに行く
    expect(fetchImpl.mock.calls[2]?.[0]).toEqual({ untilId: 'c00' })
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

describe('useNoteColumn: Worker 待ちの間にクエリが変わったら旧判定を捨てる (#1119)', () => {
  // どちらも str.len を含むので全体が 🐢 (Worker 逐次適用) に降格する
  const ACCEPT_LONG = 'note.text.len > 3'
  const REJECT_ALL = 'note.text.len > 100'
  const ACCEPT_UNREACTED = 'note.text.len > 3 && note.reactions["👍"] == null'

  /** Worker 応答を止める gate と、それを解く関数 */
  function deferredGate() {
    let resolve: (() => void) | undefined
    const gate = new Promise<void>((r) => {
      resolve = r
    })
    return { gate, release: () => resolve?.() }
  }

  /** streaming の購読は adapter 解決後に非同期で張られるので、コールバックは後から読む */
  function mountReactive(opts: {
    accountId: string
    columnId: string
    column: Ref<Partial<DeckColumn>>
    fetch: () => Promise<NormalizedNote[]>
  }) {
    let api: ReturnType<typeof useNoteColumn> | null = null
    const stream = {
      enqueue: null as ((n: NormalizedNote) => void) | null,
      onNoteUpdated: null as ((e: NoteUpdateEvent) => void) | null,
    }
    const Host = defineComponent({
      setup() {
        api = useNoteColumn({
          getColumn: () =>
            ({
              id: opts.columnId,
              type: 'timeline',
              accountId: opts.accountId,
              ...opts.column.value,
            }) as DeckColumn,
          fetch: opts.fetch,
          cache: { getKey: () => 'home' },
          streaming: {
            subscribe: (_adapter, enq, callbacks) => {
              stream.enqueue = enq
              stream.onNoteUpdated = callbacks.onNoteUpdated
              return { dispose: vi.fn() }
            },
          },
        })
        return () => null
      },
    })
    const app = createApp(Host)
    app.use(pinia)
    app.mount(document.createElement('div'))
    apps.push(app)
    if (!api) throw new Error('harness failed')
    return { api: api as ReturnType<typeof useNoteColumn>, stream }
  }

  beforeEach(() => {
    degraded.suspended.clear()
    degraded.runCalls.length = 0
    degraded.gate = null
    frameScheduler.immediate = true
  })

  afterEach(() => {
    frameScheduler.immediate = false
    // 失敗して release されなかった gate を次のテストに持ち越さない
    degraded.gate = null
  })

  it('hold-and-release: 旧クエリが通したノートを新クエリ適用後の列に入れない', async () => {
    addAccount('acc-gen-hold')
    const column = ref<Partial<DeckColumn>>({ noteQuery: ACCEPT_LONG })
    const { api, stream } = mountReactive({
      accountId: 'acc-gen-hold',
      columnId: 'col-gen-hold',
      column,
      fetch: async () => [],
    })
    await flush()
    expect(ids(api)).toEqual([])

    // Worker 応答を止めたまま streaming で 1 件到着 → 判定待ちに積まれる
    const { gate, release } = deferredGate()
    degraded.gate = gate
    stream.enqueue?.({
      ...note('n1'),
      _accountId: 'acc-gen-hold',
      text: 'hello world',
    } as NormalizedNote)
    await flush()
    expect(degraded.runCalls.length).toBe(1)

    // 待っている間にクエリが「全件除外」へ変わる (この再適用 / 再取得は止めない)
    degraded.gate = null
    column.value = { noteQuery: REJECT_ALL }
    await flush(20)

    // 旧クエリの判定が返る → 捨てて新クエリで評価し直すので列に入らない
    release()
    await flush(20)
    expect(ids(api)).toEqual([])
  })

  it('更新後の再評価: 新クエリなら残るノートを旧クエリの判定で消さない', async () => {
    addAccount('acc-gen-update')
    const column = ref<Partial<DeckColumn>>({ noteQuery: ACCEPT_UNREACTED })
    const { api, stream } = mountReactive({
      accountId: 'acc-gen-update',
      columnId: 'col-gen-update',
      column,
      fetch: async () => [
        {
          ...note('n1'),
          _accountId: 'acc-gen-update',
          text: 'hello world',
        } as NormalizedNote,
      ],
    })
    await flush()
    expect(ids(api)).toEqual(['n1'])

    // Worker 応答を止めたまま 👍 が付く → 旧クエリでは外れる判定になる
    const { gate, release } = deferredGate()
    degraded.gate = gate
    stream.onNoteUpdated?.({
      type: 'reacted',
      accountId: 'acc-gen-update',
      noteId: 'n1',
      body: { reaction: '👍', userId: 'someone-else' },
    } as NoteUpdateEvent)
    await flush()
    expect(degraded.runCalls.length).toBe(2)

    // 待っている間にクエリが「👍 を問わない」へ変わる
    degraded.gate = null
    column.value = { noteQuery: ACCEPT_LONG }
    await flush(20)
    expect(ids(api)).toEqual(['n1'])

    // 旧クエリの「外れる」判定が返っても、新クエリで評価し直すので残る
    release()
    await flush(20)
    expect(ids(api)).toEqual(['n1'])
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

describe('useNoteColumn: fail-closed から解除したときの再取得 (#957)', () => {
  it('ストリーミングカラムが空でもクエリ変更で取り直す', async () => {
    addAccount('acc-refetch-empty')
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
              id: 'col-refetch-empty',
              type: 'timeline',
              accountId: 'acc-refetch-empty',
              ...column.value,
            }) as DeckColumn,
          fetch: () => fetchImpl(),
          cache: { getKey: () => 'home' },
          // 復帰 catch-up 経路に入るのはストリーミングカラムだけ
          streaming: { subscribe: () => ({ dispose: vi.fn() }) },
        })
        return () => null
      },
    })
    const app = createApp(Host)
    app.use(pinia)
    app.mount(document.createElement('div'))
    apps.push(app)
    await flush()
    // 全件フィルタ落ちで空 (fail-closed 相当)
    expect(ids(api as never)).toEqual([])

    column.value = {}
    await flush(20)

    // 空のままにせず取り直していること
    expect(ids(api as never).length).toBeGreaterThan(0)
  })
})

describe('useNoteColumn: セーフモードでカラムクエリを停止する (#838 条件 3)', () => {
  const FAST_QUERY = 'note.text != null'

  beforeEach(() => {
    localStorage.setItem('nd-safe-mode', 'true')
  })

  afterEach(() => {
    localStorage.removeItem('nd-safe-mode')
  })

  it('クエリ付きカラムがフィルタなしで全ノート表示になる (fail-open)', async () => {
    addAccount('acc-safe-open')
    const { api } = mountColumn({
      accountId: 'acc-safe-open',
      noteQuery: FAST_QUERY,
      fetch: async () => [
        { ...note('a'), text: 'x' } as NormalizedNote,
        // 通常ならクエリで除外されるノート
        { ...note('b'), text: null } as NormalizedNote,
      ],
    })
    await flush()
    expect(ids(api)).toEqual(['a', 'b'])
    // 評価はしない (コンパイルしない) が、止まっていることは見える (#971)
    expect(api.columnQueryState.value.status).toBe('safeMode')
  })

  it('クエリ未設定のカラムは safeMode 状態にならない (#971)', async () => {
    addAccount('acc-safe-noquery')
    const { api } = mountColumn({
      accountId: 'acc-safe-noquery',
      fetch: async () => [note('a') as NormalizedNote],
    })
    await flush()
    expect(api.columnQueryState.value.status).toBe('none')
  })

  it('参照だけのカラムでも停止が見える (#971)', async () => {
    addAccount('acc-safe-ref')
    const { api } = mountColumn({
      accountId: 'acc-safe-ref',
      noteQueryRefs: ['some-query-id'],
      fetch: async () => [note('a') as NormalizedNote],
    })
    await flush()
    expect(api.columnQueryState.value.status).toBe('safeMode')
  })

  it('qirSearchCache を呼ばず従来のキャッシュ経路を使う', async () => {
    addAccount('acc-safe-cache')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce([{ ...note('h05'), text: 'hello' }])
      .mockRejectedValueOnce(new Error('offline'))
    const { api } = mountColumn({
      accountId: 'acc-safe-cache',
      noteQuery: FAST_QUERY,
      fetch: () => fetchImpl(),
    })
    await flush()
    await api.loadMore()
    await flush()

    expect(
      bindings.calls.filter((c) => c.name === 'qirSearchCache'),
    ).toHaveLength(0)
    expect(
      bindings.calls.filter((c) => c.name === 'apiGetCachedTimelineBefore'),
    ).toHaveLength(1)
  })
})

describe('useNoteColumn: 保留表示と「再開」は評価対象のクエリだけを追う (#1110)', () => {
  const SLOW_QUERY = 'note.text != null && note.text.len > 3'
  const notes2 = async () => [
    { ...note('a'), text: 'hello world' } as NormalizedNote,
    { ...note('b'), text: 'hello there' } as NormalizedNote,
  ]

  function mountMutable(accountId: string, column: Ref<Partial<DeckColumn>>) {
    let api: ReturnType<typeof useNoteColumn> | null = null
    const Host = defineComponent({
      setup() {
        api = useNoteColumn({
          getColumn: () =>
            ({
              id: `col-${accountId}`,
              type: 'timeline',
              accountId,
              ...column.value,
            }) as DeckColumn,
          fetch: notes2,
          cache: { getKey: () => 'home' },
        })
        return () => null
      },
    })
    const app = createApp(Host)
    app.use(pinia)
    app.mount(document.createElement('div'))
    apps.push(app)
    if (!api) throw new Error('harness setup failed')
    return api as ReturnType<typeof useNoteColumn>
  }

  beforeEach(() => {
    degraded.suspended.clear()
    degraded.listeners.clear()
  })

  it('適用トグルで外したクエリの保留表示と保留件数が消える', async () => {
    addAccount('acc-1110-drop')
    degraded.suspended.add('col-acc-1110-drop:inline')
    const column = ref<Partial<DeckColumn>>({ noteQuery: SLOW_QUERY })
    const api = mountMutable('acc-1110-drop', column)
    await flush()
    expect(api.columnQuerySuspendedKeys.value).toEqual([
      'col-acc-1110-drop:inline',
    ])
    expect(api.columnQuerySuspendedCount.value).toBe(2)

    column.value = {}
    await flush(20)
    expect(api.columnQuerySuspendedKeys.value).toEqual([])
    expect(api.columnQuerySuspendedCount.value).toBe(0)
    expect(ids(api)).toEqual(['a', 'b'])
  })

  it('「再開」は評価対象から外れたクエリのサスペンドを解除しない', async () => {
    addAccount('acc-1110-resume')
    degraded.suspended.add('col-acc-1110-resume:inline')
    const column = ref<Partial<DeckColumn>>({ noteQuery: SLOW_QUERY })
    const api = mountMutable('acc-1110-resume', column)
    await flush()

    column.value = {}
    await flush(20)
    api.resumeSuspendedQueries()
    await flush()
    // 外れたクエリは他カラムで効いているかもしれない。黙って走らせ直さない
    expect(degraded.suspended.has('col-acc-1110-resume:inline')).toBe(true)
  })

  it('別カラムでの再開が、バッチを通らなくても即時に反映される', async () => {
    addAccount('acc-1110-other')
    degraded.suspended.add('col-acc-1110-other:inline')
    const column = ref<Partial<DeckColumn>>({ noteQuery: SLOW_QUERY })
    const api = mountMutable('acc-1110-other', column)
    await flush()
    expect(api.columnQuerySuspendedKeys.value).toEqual([
      'col-acc-1110-other:inline',
    ])

    // 同じクエリを持つ別カラムが「再開」した (共有 runner の状態が変わる)
    degraded.suspended.delete('col-acc-1110-other:inline')
    degraded.notify()
    await flush()
    expect(api.columnQuerySuspendedKeys.value).toEqual([])
  })
})

describe('useNoteColumn: 無効なクエリは評価上「無いもの」(#1043)', () => {
  const FAST = 'note.text != null'
  const SLOW = 'note.text != null && note.text.len > 3'
  function seed(
    id: string,
    src: string,
    extra: Partial<NamedQueryMeta> = {},
  ): void {
    const store = useColumnQueriesStore()
    store.ensureLoaded()
    store.queries.push({
      id,
      name: `named-${id}`,
      src,
      createdAt: 0,
      updatedAt: 0,
      ...extra,
    })
  }
  const mixed = async () => [
    { ...note('a'), text: 'hello world' } as NormalizedNote,
    { ...note('b'), text: null } as NormalizedNote,
  ]

  it('無効な参照だけのカラムは絞り込まず、状態は「停止」', async () => {
    seed('q-off-1', FAST, { disabled: true })
    addAccount('acc-1043-only')
    const { api } = mountColumn({
      accountId: 'acc-1043-only',
      noteQueryRefs: ['q-off-1'],
      fetch: mixed,
    })
    await flush()
    expect(ids(api)).toEqual(['a', 'b'])
    expect(api.columnQueryState.value.status).toBe('disabled')
    expect(api.columnQueryState.value.disabled).toEqual(['named-q-off-1'])
  })

  it('一部だけ無効なら有効な部分で状態が決まり、無効名が付く', async () => {
    seed('q-off-2', SLOW, { disabled: true })
    seed('q-on-2', FAST)
    addAccount('acc-1043-mix')
    const runsBefore = degraded.runCalls.length
    const { api } = mountColumn({
      accountId: 'acc-1043-mix',
      noteQueryRefs: ['q-off-2', 'q-on-2'],
      fetch: mixed,
    })
    await flush()
    expect(ids(api)).toEqual(['a'])
    // 🐢 が無効なので ⚡ に戻る (逐次適用に落ちない)
    expect(api.columnQueryState.value.status).toBe('active')
    expect(api.columnQueryState.value.disabled).toEqual(['named-q-off-2'])
    expect(degraded.runCalls).toHaveLength(runsBefore)
  })

  it('解釈不能なクエリも無効化すれば fail-closed から復帰する', async () => {
    seed('q-bad', 'Date:now() > 0', { disabled: true })
    addAccount('acc-1043-bad')
    const { api } = mountColumn({
      accountId: 'acc-1043-bad',
      noteQueryRefs: ['q-bad'],
      fetch: mixed,
    })
    await flush()
    expect(api.columnQueryState.value.status).toBe('disabled')
    expect(ids(api)).toEqual(['a', 'b'])
  })

  it('無効と参照消失の混在は fail-closed のまま', async () => {
    seed('q-off-3', FAST, { disabled: true })
    addAccount('acc-1043-missing')
    const { api } = mountColumn({
      accountId: 'acc-1043-missing',
      noteQueryRefs: ['q-off-3', 'q-gone'],
      fetch: mixed,
    })
    await flush()
    expect(api.columnQueryState.value.status).toBe('invalid')
    expect(ids(api)).toEqual([])
  })

  it('インライン式 + 全参照無効ならインライン式で状態が決まる', async () => {
    seed('q-off-4', SLOW, { disabled: true })
    addAccount('acc-1043-inline')
    const { api } = mountColumn({
      accountId: 'acc-1043-inline',
      noteQuery: FAST,
      noteQueryRefs: ['q-off-4'],
      fetch: mixed,
    })
    await flush()
    expect(api.columnQueryState.value.status).toBe('active')
    expect(ids(api)).toEqual(['a'])
  })

  it('セーフモード中は無効なクエリがあってもセーフモード表示が優先', async () => {
    localStorage.setItem('nd-safe-mode', 'true')
    try {
      seed('q-off-5', FAST, { disabled: true })
      addAccount('acc-1043-safe')
      const { api } = mountColumn({
        accountId: 'acc-1043-safe',
        noteQueryRefs: ['q-off-5'],
        fetch: mixed,
      })
      await flush()
      expect(api.columnQueryState.value.status).toBe('safeMode')
    } finally {
      localStorage.removeItem('nd-safe-mode')
    }
  })

  it('有効 / 無効を切り替えると参照カラムが即時再適用 + 再取得する', async () => {
    seed('q-tog', FAST)
    addAccount('acc-1043-toggle')
    const fetchImpl = vi.fn(mixed)
    const { api } = mountColumn({
      accountId: 'acc-1043-toggle',
      noteQueryRefs: ['q-tog'],
      fetch: fetchImpl,
    })
    await flush()
    expect(ids(api)).toEqual(['a'])
    const calls = fetchImpl.mock.calls.length

    await useColumnQueriesStore().setDisabled('q-tog', true)
    await flush(20)
    expect(ids(api)).toEqual(['a', 'b'])
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(calls)

    await useColumnQueriesStore().setDisabled('q-tog', false)
    await flush(20)
    expect(ids(api)).toEqual(['a'])
  })
})

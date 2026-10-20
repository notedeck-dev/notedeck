import {
  computed,
  nextTick,
  onMounted,
  onScopeDispose,
  type Ref,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type {
  ChannelSubscription,
  ManagedChannelSubscription,
  NormalizedNote,
  NoteUpdateEvent,
  ServerAdapter,
  SubscriptionRuntimeState,
} from '@/adapters/types'
import { useColumnLive } from '@/composables/useColumnMount'
import { useColumnQuery } from '@/composables/useColumnQuery'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { useMultiNoteCapture } from '@/composables/useMultiNoteCapture'
import {
  loadCachedTimeline,
  loadCachedTimelineBefore,
} from '@/composables/useNoteColumnCache'
import { useNoteList } from '@/composables/useNoteList'
import { useNoteScrollerRef } from '@/composables/useNoteScrollerRef'
import type { VisibilityOpts } from '@/composables/useNoteVisibility'
import { usePullToRefresh } from '@/composables/usePullToRefresh'
import { useStreamingBatch } from '@/composables/useStreamingBatch'
import { i18n } from '@/i18n'
import {
  accountSource,
  type ColumnSource,
  normalizeSources,
  parseSourceKey,
  type SourceKey,
  sourceKey,
} from '@/services/columnSource'
import { mapWithConcurrency, type SettleProgress } from '@/services/concurrency'
import {
  type AccountCursor,
  advanceCursor,
  horizonOf,
  initialCursor,
  markFailed,
  nextHorizon,
  pickNextAccount,
  reseedFromRows,
  resetCursor,
} from '@/services/crossAccountPaging'
import { type VariantKey, variantKey, variantKeyOf } from '@/services/noteKey'
import { rateLimitRetryAfter } from '@/services/rateLimit'
import { insertIntoSorted } from '@/services/sortNotes'
import { hasGap } from '@/services/timelineGap'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import { useStreamInspectorStore } from '@/stores/streamInspector'
import { useSystemStateStore } from '@/stores/systemState'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { scrollToTopSmart } from '@/utils/motion'
import { createWorkerClient } from '@/utils/workerClient'
import type { DedupResponse } from '@/workers/dedupWorker'

export interface CrossAccountNotesOptions {
  /**
   * 1 つの取得単位 (組) のノートを取る。全アカウントを 1 回ずつ回す面では
   * `source.id` は空、組を束ねる面 (#1017 案 2) ではリソース ID が入る
   */
  fetchNotes: (
    adapter: ServerAdapter,
    opts: { untilId?: string } | undefined,
    source: ColumnSource,
  ) => Promise<NormalizedNote[]>

  /**
   * 束ねる組 (#1017 案 2)。未指定なら「ログイン中の全アカウントを 1 回ずつ」。
   * 指定すると (アカウント, リソース ID) の組ごとに取得・遡り・購読する。
   * アカウント一覧に無いアカウントの組は無視する
   */
  sources?: () => readonly ColumnSource[]

  /** Whether this is cross-account mode */
  isCrossAccount: () => boolean

  /**
   * Offline cache key (e.g. 'mentions' | 'specified')。指定すると、
   * ログイン中アカウントが無い（全員ログアウト）場合でも全アカウントの
   * SQLite キャッシュを読んで表示する。未指定なら従来通り live のみ。
   * 組を束ねる面では組ごとのキー (`user-list:<id>` 等) を返す
   */
  cacheKey?: (source: ColumnSource) => string | null

  /** Loading / error / scroller refs from useColumnSetup */
  isLoading: Ref<boolean>
  error: Ref<AppError | null>
  scroller: Ref<HTMLElement | null>
  onScrollReport: () => void
  closePostForm?: () => void
  /**
   * 行削除の実体。useColumnSetup の `handlers.delete` を渡す (取得元アカウントで
   * adapter を解決し、失敗は toast で伝える)。ここで自前に書くと未ログイン
   * 判定と失敗通知を迂回する
   */
  deleteNote: (note: NormalizedNote) => Promise<boolean>

  /**
   * 表示制御の例外 (per-account の `NoteColumnConfig.visibility` と同じ)。
   * お気に入りのような「自分が保存した面」は凍結を貫通させる (#606)
   */
  visibility?: VisibilityOpts

  /**
   * ライブ更新 (#1059)。アカウントごとに購読し、新着は 1 つの
   * useStreamingBatch に合流させる。同じ identity の group が既に列にある
   * variant は行を増やさず差し込む (サイレント挿入、#1058 §6)。
   * `columnId` は可視 / live 予算の判定に使う
   */
  streaming?: {
    columnId: string
    /** Stream Inspector に出すカラム種別 (購読はアカウントごとに 1 行) */
    columnType: string
    subscribe: (
      accountId: string,
      adapter: ServerAdapter,
      enqueue: (note: NormalizedNote) => void,
      callbacks: { onNoteUpdated: (event: NoteUpdateEvent) => void },
      source: ColumnSource,
    ) => ChannelSubscription
  }

  /**
   * 下方向のページングの規則 (#1184)。'horizon' は列の底を「まだ遡れるアカウントの
   * うち到達点がいちばん浅いもの」で揃え、それより古い行は表示に出さない。追加読み込みは
   * そのアカウントだけ 1 ページ取る。createdAt 順で並ぶ面 (TL / メンション) だけが指定する。
   * 未指定は従来どおり全アカウントを各自の最古行から遡る (お気に入りのように並びが
   * createdAt でない面)
   */
  paging?: 'horizon'

  /**
   * 面ごとのページング位置の取り方 (per-account の `NoteColumnConfig.cursorOf` と同じ)。
   * 既定は生ページの createdAt 最古。お気に入りは「ページ末尾のお気に入り ID」。
   * 水平線を使わない面でも、遡りの位置は列の行ではなくこれで持つ (列の切り詰めで
   * 行が消えると位置を失い、最新ページを取り直す往復になる)
   */
  cursorOf?: (
    page: NormalizedNote[],
  ) => { id: string; createdAt: string } | null

  /**
   * 組込フィルタ (#841) + カラムクエリ (#783) を全アカウント面にも通す。
   * per-account と同じ評価器 (useColumnQuery) を使い、全取り込み経路
   * (キャッシュ / 初回 / 追加読み込み / 復帰 / streaming) で AND 合成する。
   * 組込フィルタの API 側パラメータは fetchNotes が渡し、ここはクライアント側の
   * 防御層 (streaming と キャッシュ) を担う。フィルタ変更は全アカウント取り直し
   */
  filter?: {
    getColumn: () => Pick<
      DeckColumn,
      'id' | 'noteQuery' | 'noteQueryRefs' | 'filters'
    >
    builtinAdmits: (note: NormalizedNote) => boolean
  }
}

/** 末尾の区切り行の状態 (#1184) */
export type CrossEndState =
  | { kind: 'aligned'; account: string; createdAt: string }
  | { kind: 'failing'; accounts: string[] }

type StreamEventName = 'connected' | 'disconnected' | 'reconnecting'

/** Promise.allSettled の結果からノートを集約 */
function collectFulfilled(
  results: PromiseSettledResult<NormalizedNote[]>[],
): NormalizedNote[] {
  const collected: NormalizedNote[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      collected.push(...r.value)
    }
  }
  return collected
}

const dedupWorker = createWorkerClient<DedupResponse>(
  () =>
    new Worker(new URL('../workers/dedupWorker.ts', import.meta.url), {
      type: 'module',
    }),
)

/** メインスレッドフォールバック（Worker が CSP 等でブロックされた場合） */
function dedupMain(
  incoming: NormalizedNote[],
  existingKeys?: Set<string>,
): NormalizedNote[] {
  const seen = existingKeys ?? new Set<string>()
  return incoming
    .filter((n) => {
      const key = variantKeyOf(n)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 既存の行キー (取得元アカウント + note id、#1010) を除外し、createdAt降順でソート（Worker で実行、失敗時メインスレッド） */
function dedupAsync(
  incoming: NormalizedNote[],
  existingKeys?: Set<string>,
): Promise<NormalizedNote[]> {
  return dedupWorker
    .post({
      type: 'dedup',
      notes: incoming,
      existingKeys: existingKeys ? [...existingKeys] : null,
    })
    .then((res) => res.notes)
    .catch(() => dedupMain(incoming, existingKeys))
}

/**
 * 全アカウント面 (メンション / ダイレクト / お気に入り 等) の取得と束ね (#1058 P2a)。
 *
 * 列は `useNoteList` (行キーの順序配列 + noteStore) に載せ、`bundle` で同一
 * identity の variant を 1 行に畳む。これで楽観更新の patch・削除 tombstone・
 * 退避保護が per-account 面と同じ経路を通り、各アカウントの接続で Note
 * Capture するので他者のリアクションもライブで届く。
 */
export function useCrossAccountNotes(options: CrossAccountNotesOptions) {
  const {
    fetchNotes,
    isCrossAccount,
    cacheKey,
    isLoading,
    error,
    scroller,
    onScrollReport,
  } = options

  const accountsStore = useAccountsStore()
  const multiAdapters = useMultiAccountAdapters()
  const toast = useToast()
  const uiStore = useUiStore()
  const systemStateStore = useSystemStateStore()
  const { noteScrollerRef } = useNoteScrollerRef(scroller)

  // --- 取得単位 (#1017 案 2) ---
  /** 束ねる組。アカウント一覧に無いアカウントの組は落とす */
  function allSources(): ColumnSource[] {
    if (!options.sources) {
      return accountsStore.accounts.map((a) => accountSource(a.id))
    }
    return normalizeSources(options.sources()).filter((s) =>
      accountsStore.accountMap.has(s.accountId),
    )
  }
  /** ログイン中のアカウントの組 (live で取れるもの) */
  function liveSources(): ColumnSource[] {
    return allSources().filter(
      (s) => accountsStore.accountMap.get(s.accountId)?.hasToken === true,
    )
  }
  function sourceOfKey(key: string): ColumnSource {
    const { accountId, id } = parseSourceKey(key as SourceKey)
    return (
      allSources().find((s) => s.accountId === accountId && s.id === id) ?? {
        accountId,
        id,
      }
    )
  }
  const cacheKeyOf = (source: ColumnSource) => cacheKey?.(source) ?? null

  // --- 水平線ページング (#1184) ---
  const horizonPaging = options.paging === 'horizon'
  /** 組 (sourceKey) 別の遡りカーソル。列の行ではなく取得した生ページで進む */
  const cursors = new Map<string, AccountCursor>()
  /** cursors の変更通知 (Map は reactive にしない) */
  const cursorsVersion = ref(0)
  function setCursor(cursor: AccountCursor) {
    cursors.set(cursor.key, cursor)
    cursorsVersion.value++
  }
  /** 表示の下限。null は制限なし。connect 世代内では単調に下がるだけ */
  const horizon = shallowRef<string | null>(null)
  /**
   * 水平線を使わない面の組別の遡り位置 (生ページ基準、#831 §1.4)。
   * 面ごとの `cursorOf` があればそれで、無ければ createdAt の最古で進む
   */
  const legacyCursors = new Map<string, { id: string; createdAt: string }>()
  /**
   * 水平線を使わない面の組別の失敗 (バックオフ)。水平線あり面の `markFailed` と同じ
   * 規則で、レート制限 (#1271) ならサーバーの示す待ち時間に従う。カーソルの
   * `failures` / `nextRetryAt` だけを使う
   */
  const legacyFailures = new Map<string, AccountCursor>()
  function pageCursorOf(
    page: readonly NormalizedNote[],
  ): { id: string; createdAt: string } | null {
    if (options.cursorOf) return options.cursorOf([...page])
    let oldest: NormalizedNote | null = null
    for (const n of page) {
      if (!oldest || n.createdAt < oldest.createdAt) oldest = n
    }
    return oldest ? { id: oldest.id, createdAt: oldest.createdAt } : null
  }
  function advanceLegacyCursor(key: string, page: readonly NormalizedNote[]) {
    const next = pageCursorOf(page)
    if (!next) return
    const cur = legacyCursors.get(key)
    const behind = options.cursorOf
      ? !cur || next.id < cur.id
      : !cur || next.createdAt < cur.createdAt
    if (behind) legacyCursors.set(key, next)
  }
  const aboveHorizon = (n: NormalizedNote) =>
    horizon.value === null || n.createdAt >= horizon.value

  const list = useNoteList({
    bundle: true,
    getAdapter: () => null,
    visibility: options.visibility,
    closePostForm: options.closePostForm ?? (() => undefined),
    deleteHandler: options.deleteNote,
    displayFloor: horizonPaging ? () => horizon.value : undefined,
  })
  const {
    notes,
    groups,
    hiddenGroups,
    rawNotes,
    noteKeys,
    setNotes,
    mergeUpdate,
    onNoteUpdate,
    removeNote,
  } = list

  // --- 組込フィルタ + カラムクエリ (per-account と同じ評価器を共有) ---
  const filter = options.filter
  const query = filter
    ? useColumnQuery({
        getColumn: filter.getColumn,
        rawNotes,
        setNotes: (n) => setNotes(n),
        // 緩和方向の回収は全アカウント取り直し (per-account の refresh 相当)
        refresh: () => connectCrossAccount(),
        enqueue: (n) => streamingBatch?.enqueueNote(n),
        onNoteUpdate,
      })
    : null
  const builtinAdmits = filter?.builtinAdmits ?? (() => true)
  /** 取り込み経路の共通ゲート: 組込 (最安) → クエリ の AND 合成 */
  async function admit(incoming: NormalizedNote[]): Promise<NormalizedNote[]> {
    const builtin = filter ? incoming.filter(builtinAdmits) : incoming
    return query ? query.applyQueryFilter(builtin) : builtin
  }
  if (filter) {
    // 組込フィルタ変更時: 絞り込み方向は表示中ノートへ即時適用、緩和方向は
    // 取り直しで回収 (useNoteColumn のフィルタシグネチャ watch と同じ)
    watch(
      () => JSON.stringify(filter.getColumn().filters ?? null),
      (next, prev) => {
        if (next === prev) return
        if (rawNotes.value.length > 0) {
          setNotes(rawNotes.value.filter(builtinAdmits))
        }
        void connectCrossAccount()
      },
    )
  }

  // 各アカウントの接続で variant を購読する (§6)。接続を持たないアカウントの
  // variant は購読しない
  const capture = useMultiNoteCapture(
    (accountId) => multiAdapters.getCached(accountId)?.stream,
    onNoteUpdate,
  )
  // 束ねる面の可視ノートは主ビューだけなので、表示中 group の全 variant を渡す。
  // 非主 variant を購読しないと、そのアカウント経由のリアクションが届かない
  list.setOnNotesChanged(() =>
    capture.sync(groups.value.flatMap((g) => g.variants)),
  )

  // --- ライブ更新: アカウント別購読 × N → 1 つの batch に合流 (#1059) ---
  const streaming = options.streaming
  const streamingBatch = streaming
    ? useStreamingBatch({
        notes: rawNotes,
        noteKeys,
        scroller,
        hasGroup: list.hasGroupFor,
        insertSilently: list.insertSilently,
        identityOf: (n) => (n._identityTrusted ? n._identity : variantKeyOf(n)),
        countsNote: horizonPaging ? aboveHorizon : undefined,
        onOverflow: () => {
          toast.show(i18n.ts._useCrossAccountNotes.overflowSkipped, 'warning')
        },
      })
    : null
  /** sourceKey → 購読。runtime state はカラム単位で共有する */
  const subscriptions = new Map<string, ChannelSubscription>()
  let runtimeState: SubscriptionRuntimeState = 'live'
  const streamHandlers: {
    adapter: ServerAdapter
    event: StreamEventName
    handler: () => void
  }[] = []
  /** connect のたびに進める。古い connect / resume の結果を捨てる */
  let generation = 0
  /**
   * connect が走っている間は true。可視性の watch が同時に動いても一時停止を
   * 解かない — 解くと取得中に届いた新着が列に入り、最終マージ (全置換) で消える
   */
  let connecting = false
  /** 全アカウント取得の進捗 (#1095)。取得中以外は null */
  const crossProgress = ref<SettleProgress | null>(null)

  function setRuntimeState(state: SubscriptionRuntimeState) {
    runtimeState = state
    for (const [key, sub] of subscriptions) {
      ;(sub as Partial<ManagedChannelSubscription>).setRuntimeState?.(state)
      reportRuntime(parseSourceKey(key as SourceKey).accountId, sub)
    }
  }

  /** Stream Inspector 用 (debug 観測のみ)。全アカウント面はアカウントごとに 1 行 */
  function reportRuntime(accountId: string, sub: ChannelSubscription) {
    if (!streaming) return
    const managed = sub as Partial<ManagedChannelSubscription>
    useStreamInspectorStore().reportRuntimeState({
      columnId: streaming.columnId,
      accountId,
      columnType: streaming.columnType,
      subscriptionId: managed.subscriptionId ?? null,
      state: runtimeState,
      ts: Date.now(),
    })
  }

  function disposeSubscriptions() {
    for (const sub of subscriptions.values()) sub.dispose()
    subscriptions.clear()
    for (const { adapter, event, handler } of streamHandlers) {
      adapter.stream.off(event, handler)
    }
    streamHandlers.length = 0
  }

  function onStreamEvent(
    adapter: ServerAdapter,
    event: StreamEventName,
    handler: () => void,
  ) {
    adapter.stream.on(event, handler)
    streamHandlers.push({ adapter, event, handler })
  }

  function subscribeSource(source: ColumnSource, adapter: ServerAdapter) {
    if (!streaming || !streamingBatch) return
    const key = sourceKey(source)
    const accountId = source.accountId
    subscriptions.get(key)?.dispose()
    const sub = streaming.subscribe(
      accountId,
      adapter,
      (note) => {
        // 組込フィルタ + クエリを enqueue の前段で通す (per-account と同じ)
        if (!builtinAdmits(note)) return
        if (query) query.enqueueWithQuery(note)
        else streamingBatch.enqueueNote(note)
      },
      {
        onNoteUpdated: (event) => {
          if (event.type === 'deleted') {
            const key = variantKey(event.accountId, event.noteId)
            streamingBatch.removePending(key)
            // 判定待ちのまま消えたノートを取り込まない
            query?.dropHeldNote(key)
          }
          if (query) query.onNoteUpdateWithQuery(event)
          else onNoteUpdate(event)
        },
      },
      source,
    )
    ;(sub as Partial<ManagedChannelSubscription>).setRuntimeState?.(
      runtimeState,
    )
    subscriptions.set(key, sub)
    reportRuntime(accountId, sub)
    // subscriptionId は open 解決後に確定するので、確定したら再通知
    ;(sub as Partial<ManagedChannelSubscription>)
      .whenReady?.()
      .then(() => reportRuntime(accountId, sub))

    // WS 瞬断からの再接続で、切断中に欠けたノートを埋める (#704 K)。
    // 初回接続では発火しない
    let wasDisconnected = false
    const markDown = () => {
      wasDisconnected = true
    }
    onStreamEvent(adapter, 'disconnected', markDown)
    onStreamEvent(adapter, 'reconnecting', markDown)
    onStreamEvent(adapter, 'connected', () => {
      if (!wasDisconnected) return
      wasDisconnected = false
      void onResume()
    })
  }

  /** 新着バナーの件数 (束ねる面なので identity の distinct 数) */
  const pendingCount = streamingBatch?.pendingCount ?? computed(() => 0)
  /**
   * スライドイン中の行キー。batch は variant key で管理するが、束ねる面の
   * 行キーは group の rowKey なので写像する
   */
  const animatingRowKeys = computed<ReadonlySet<string>>(() => {
    const ids = streamingBatch?.animatingIds.value
    // 空のたびに new Set を返すと computed が毎回「変わった」扱いになり、
    // 受け取る NoteScroller の全行が再描画される
    if (!ids || ids.size === 0) return NO_ROW_KEYS
    const out = new Set<string>()
    for (const g of groups.value) {
      if (g.variants.some((v) => ids.has(variantKeyOf(v)))) out.add(g.rowKey)
    }
    return out
  })

  function scrollToTop() {
    streamingBatch?.flushToTop()
    nextTick(() => {
      if (noteScrollerRef.value) {
        noteScrollerRef.value.scrollToTop()
      } else {
        scrollToTopSmart(scroller.value)
      }
    })
  }

  // 可視 / live 予算に応じて batch と Rust 側購読を制御する。規則は
  // useNoteColumn と同じ: 不可視は pause + warm、可視・予算外は pause のまま
  // 購読だけ live (suspend 中のリアクションを取り逃さない)、可視・予算内は
  // catch-up してから live
  let wantLive = !streaming
  if (streaming && streamingBatch) {
    const { isVisible, isLive } = useColumnLive(streaming.columnId)
    let transition = 0
    watch(
      [isVisible, isLive, () => systemStateStore.adaptation.suspendStreams],
      async ([visible, live, suspended]) => {
        const seq = ++transition
        wantLive = false
        streamingBatch.setPaused(true)
        if (!visible || suspended) {
          setRuntimeState('warm')
          return
        }
        if (!live) {
          setRuntimeState('live')
          return
        }
        await onResume()
        if (seq !== transition) return
        wantLive = true
        setRuntimeState('live')
        if (!connecting) streamingBatch.setPaused(false)
      },
      { immediate: true },
    )

    // 端末復帰 (スリープ / タイムジャンプ): 全接続を張り直して catch-up
    watch(
      () => uiStore.deckResumeSignal,
      () => {
        for (const acc of accountsStore.accounts) {
          multiAdapters.getCached(acc.id)?.stream.reconnect()
        }
        void onResume()
      },
    )

    onScopeDispose(disposeSubscriptions)
  }

  let lastResumeAt = 0
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  onScopeDispose(() => {
    if (resumeTimer) clearTimeout(resumeTimer)
  })

  /**
   * 接続時に adapter を作れなかった (サーバー情報の解決に失敗した等) アカウントは
   * 購読が無いまま残る。後で取得に成功した時点で購読を張る
   */
  function ensureSubscribed(
    source: ColumnSource,
    adapter: ServerAdapter,
    gen: number,
  ) {
    if (!streaming || gen !== generation) return
    if (subscriptions.has(sourceKey(source))) return
    adapter.stream.connect()
    subscribeSource(source, adapter)
  }

  /**
   * Pull to Refresh (per-account の pullRefresh 相当)。列があれば復帰時と同じ
   * catch-up (アカウントごとに最新ページを取り、重なりで差し替え / 新着を
   * 流す) を throttle 無しで走らせ、無ければ取り直す。終わったら先頭へ
   */
  async function pullRefresh(): Promise<void> {
    if (rawNotes.value.length === 0 || !streamingBatch) {
      await connectCrossAccount()
    } else {
      lastResumeAt = 0
      await onResume()
    }
    scrollToTop()
  }
  const {
    isPulling,
    isPulledEnough,
    isRefreshing,
    pullDistance,
    displayHeight,
  } = usePullToRefresh(scroller, pullRefresh)

  /**
   * 復帰時の catch-up。アカウントごとに最新ページを取り、そのアカウントの行と
   * 1 件も重ならなければ (1 ページ超の欠落) そのアカウントの variant だけを
   * 置換する。他アカウントの行は消さない (#1058 §6)。重なりがあれば既存は
   * 更新、新規は新着バナー経由で流す
   */
  async function onResume() {
    if (!isCrossAccount() || !streamingBatch) return
    if (rawNotes.value.length === 0) {
      // 起動時に全アカウントの取得が失敗しキャッシュも無いと列は空のまま。
      // 復帰 (回線が戻った / 画面に戻った) は取り直しの合図にする。
      // 一度も connect していない (mount 直後の watch) / 取得中は走らせない
      if (generation > 0 && !isLoading.value) void connectCrossAccount()
      return
    }
    // ウィンドウが隠れている間 (#986) は REST を叩かない (useNoteColumn と同じ)
    if (systemStateStore.adaptation.suspendStreams) return
    const now = Date.now()
    if (now - lastResumeAt < 3000) {
      // 間引きで落とさず後ろにずらす。複数アカウントが数秒ずれて再接続すると、
      // 後から戻ったアカウントの catch-up が黙って消える
      if (!resumeTimer) {
        resumeTimer = setTimeout(
          () => {
            resumeTimer = null
            void onResume()
          },
          3000 - (now - lastResumeAt),
        )
      }
      return
    }
    lastResumeAt = now

    const sources = liveSources()
    if (sources.length === 0) return
    const gen = generation
    const results = await mapWithConcurrency(
      sources,
      async (s): Promise<[ColumnSource, NormalizedNote[]]> => {
        const adapter = await multiAdapters.getOrCreate(s.accountId)
        if (!adapter) return [s, []]
        ensureSubscribed(s, adapter, gen)
        try {
          return [s, await fetchNotes(adapter, undefined, s)]
        } catch {
          return [s, []]
        }
      },
      3,
    )
    if (gen !== generation) return

    const current = rawNotes.value
    const gapAccounts = new Set<string>()
    const replacement: NormalizedNote[] = []
    const overlap: NormalizedNote[] = []
    // 置換はアカウント単位。行はどの組から来たかを持たないので、同じアカウントの
    // 組 (#1017 案 2) はまとめて置換する。判定は組ごと — ページを合わせて判定すると、
    // 1 つの組が既存行と重なるだけで別の組の欠落が隠れる
    const pagesByAccount = new Map<string, [ColumnSource, NormalizedNote[]][]>()
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      const pages = pagesByAccount.get(r.value[0].accountId)
      if (pages) pages.push(r.value)
      else pagesByAccount.set(r.value[0].accountId, [r.value])
    }
    for (const [accountId, pages] of pagesByAccount) {
      const fetched = pages.flatMap(([, page]) => page)
      const shown = new Set<VariantKey>()
      for (const n of current) {
        if (n._accountId === accountId) shown.add(variantKeyOf(n))
      }
      const gapped = pages.some(
        ([, page]) => page.length > 0 && hasGap(page, shown, shown.size > 0),
      )
      if (gapped) {
        gapAccounts.add(accountId)
        replacement.push(...fetched)
        // 置換したアカウントの到達点は最新ページに戻る。水平線は上げない
        // (1 アカウントの gap で他アカウントの表示行を消さない)
        if (horizonPaging) {
          for (const [s, page] of pages) {
            const key = sourceKey(s)
            setCursor(resetCursor(cursors.get(key) ?? initialCursor(key), page))
          }
        }
      } else {
        overlap.push(...fetched)
      }
    }

    if (gapAccounts.size > 0) {
      const kept = current.filter((n) => !gapAccounts.has(n._accountId))
      // 置換分だけ判定する (kept は取り込み時に判定済み。二重に数えない)
      const admittedReplacement = await admit(replacement)
      if (gen !== generation) return
      setNotes(await dedupAsync([...admittedReplacement, ...kept]))
      if (gen !== generation) return
    }
    if (overlap.length > 0) {
      // 取り直した分は既存・新規を問わず判定を通す (#1120)。復帰は取りこぼした
      // 更新を回収する経路なので、切断中の編集で本文が変わって合致しなくなった
      // 既存ノートはここで表示から外す
      const admitted = await admit(overlap)
      if (gen !== generation) return
      const admittedKeys = new Set(admitted.map(variantKeyOf))
      const dropped = new Set(
        overlap
          .map(variantKeyOf)
          .filter((k) => noteKeys.has(k) && !admittedKeys.has(k)),
      )
      if (dropped.size > 0) {
        setNotes(rawNotes.value.filter((n) => !dropped.has(variantKeyOf(n))))
      }
      const existing = admitted.filter((n) => noteKeys.has(variantKeyOf(n)))
      const brandNew = admitted.filter((n) => !noteKeys.has(variantKeyOf(n)))
      if (existing.length > 0) mergeUpdate(existing)
      if (brandNew.length > 0) {
        streamingBatch.addQueued(brandNew)
        // 最上部にいるときだけ即 flush。スクロール中はバナーに留める (#791)
        if (streamingBatch.isAtTop.value) scrollToTop()
      }
    }
  }

  /**
   * 全組（ログアウト済みアカウント含む）の SQLite キャッシュを読んで merge する。
   * 組ごとの読み出しも返す (カーソルは組ごとに遡らせるため。行は束ねた後どの組から
   * 来たかを持たない)
   */
  async function loadCrossAccountCache(): Promise<{
    notes: NormalizedNote[]
    bySource: Map<string, NormalizedNote[]>
  }> {
    const bySource = new Map<string, NormalizedNote[]>()
    if (!cacheKey) return { notes: [], bySource }
    const targets = allSources()
    const results = await mapWithConcurrency(
      targets,
      async (s) => {
        const key = cacheKeyOf(s)
        if (!key) return []
        try {
          return await loadCachedTimeline(s.accountId, key)
        } catch {
          return []
        }
      },
      3,
    )
    results.forEach((r, i) => {
      const s = targets[i]
      if (s && r.status === 'fulfilled') bySource.set(sourceKey(s), r.value)
    })
    return { notes: await dedupAsync(collectFulfilled(results)), bySource }
  }

  /**
   * 最新ページと重ならないアカウントのキャッシュを落とす (#1184)。per-account の
   * 起動時と同じ gap 判定 (#791) をアカウントごとに当てる: 重なりが無ければ
   * 間に穴があり、残すと追加読み込みがキャッシュの最古から遡って穴が埋まらない
   */
  function dropGappedCache(
    live: NormalizedNote[],
    cached: NormalizedNote[],
  ): NormalizedNote[] {
    const liveByAccount = new Map<string, NormalizedNote[]>()
    for (const n of live) {
      const list = liveByAccount.get(n._accountId)
      if (list) list.push(n)
      else liveByAccount.set(n._accountId, [n])
    }
    const gapped = new Set<string>()
    for (const [accountId, fetched] of liveByAccount) {
      const shown = new Set<VariantKey>()
      for (const n of cached) {
        if (n._accountId === accountId) shown.add(variantKeyOf(n))
      }
      if (hasGap(fetched, shown, shown.size > 0)) gapped.add(accountId)
    }
    if (gapped.size === 0) return cached
    return cached.filter((n) => !gapped.has(n._accountId))
  }

  async function connectCrossAccount() {
    error.value = null
    isLoading.value = true
    connecting = true
    const gen = ++generation
    // 取得中の auto-flush ちらつきを防ぐ。購読は張り直す (TL タブ切替も
    // ここを通るため、旧タブの購読を残さない)
    streamingBatch?.setPaused(true)
    streamingBatch?.resetBatch()
    disposeSubscriptions()
    cursors.clear()
    cursorsVersion.value++
    horizon.value = null
    legacyCursors.clear()
    legacyFailures.clear()

    // オフラインファースト: キャッシュを即時表示（ログアウト中のアカウント分も含む）
    const { notes: cached, bySource: cachedBySource } =
      await loadCrossAccountCache()
    if (gen !== generation) return
    if (cached.length > 0) {
      const admitted = await admit(cached)
      if (gen !== generation) return
      setNotes(admitted)
    }

    const targets = liveSources()
    // 全アカウントがログアウト中なら live fetch せずキャッシュ表示のみ。
    // キャッシュも無ければ (最後のアカウントを消した等) 表示を空にする —
    // 上の setNotes は空キャッシュで呼ばないので、ここで消さないと削除済み
    // アカウントの行が残る
    if (targets.length === 0) {
      if (cached.length === 0) setNotes([])
      else if (horizonPaging) {
        // キャッシュだけの列にも水平線を当てる (最終マージを通らない分岐)
        seedCursors([], cached, [], cachedBySource)
        settleHorizon()
      }
      connecting = false
      isLoading.value = false
      if (wantLive) streamingBatch?.setPaused(false)
      return
    }

    try {
      crossProgress.value = { done: 0, total: targets.length }
      const live: NormalizedNote[] = []
      await mapWithConcurrency(
        targets,
        async (s) => {
          const adapter = await multiAdapters.getOrCreate(s.accountId)
          if (!adapter) return []
          // capture 用に接続を張る (既に接続済みなら no-op)
          adapter.stream.connect()
          if (gen === generation) subscribeSource(s, adapter)
          return fetchNotes(adapter, undefined, s)
        },
        3,
        async (r, s, progress) => {
          if (gen !== generation) return
          crossProgress.value = progress
          const key = sourceKey(s)
          if (r.status !== 'fulfilled' || !r.value) {
            // 到達点が無い (取れなかった) 組。水平線は決めないが、追加読み込みで
            // 先に最新ページを取り直す対象になる
            if (horizonPaging && r.status === 'rejected') {
              setCursor(
                markFailed(
                  initialCursor(key),
                  Date.now(),
                  rateLimitRetryAfter(r.reason),
                ),
              )
            }
            return
          }
          // 到達点は生ページ (フィルタ前) で決める
          if (horizonPaging) setCursor(resetCursor(initialCursor(key), r.value))
          else advanceLegacyCursor(key, r.value)
          live.push(...r.value)
          // 何も出ていなければ最初に返った分で描画する (#1095)。既に何か
          // (キャッシュや先に返った分) が出ていれば全部揃ってから 1 回で
          // 並べ直す — 速い分を先に出すと後から上に差し込まれて画面が動く
          // ので、動くのは最大 1 回に抑える
          if (
            rawNotes.value.length === 0 &&
            r.value.length > 0 &&
            progress.done < progress.total
          ) {
            const painted = await admit(
              await dedupAsync([...live, ...dropGappedCache(live, cached)]),
            )
            if (gen === generation) setNotes(painted)
          }
        },
      )
      if (gen !== generation) return

      // live を優先しつつキャッシュとマージ（dedup は先勝ち）
      const keptCache = dropGappedCache(live, cached)
      const merged = await admit(await dedupAsync([...live, ...keptCache]))
      if (gen !== generation) return
      if (horizonPaging) {
        // 切り詰めは見えている行で数えるので、先に水平線を仮置きしてから載せる
        seedCursors(live, keptCache, targets, cachedBySource)
        horizon.value = horizonOf([...cursors.values()])
      }
      setNotes(merged)
      if (horizonPaging) settleHorizon()
    } catch (e) {
      if (gen === generation) error.value = AppError.from(e)
    } finally {
      if (gen === generation) {
        connecting = false
        isLoading.value = false
        crossProgress.value = null
        if (wantLive) streamingBatch?.setPaused(false)
      }
    }
  }

  /**
   * 起動時のカーソル: live のページで置いた到達点に、残したキャッシュの分だけ
   * 遡らせる。トークンの無いアカウントの組はキャッシュが到達点のすべてで、
   * キャッシュも無ければ遡れない (尽きた扱い)。遡らせるのはその組のキャッシュの
   * うち列に残した行だけ (同じアカウントの別の組の行で遡ると、間を飛ばす)
   */
  function seedCursors(
    live: readonly NormalizedNote[],
    keptCache: readonly NormalizedNote[],
    liveTargets: readonly ColumnSource[],
    cachedBySource: ReadonlyMap<string, readonly NormalizedNote[]>,
  ) {
    const liveKeys = new Set(liveTargets.map(sourceKey))
    const keptKeys = new Set(keptCache.map(variantKeyOf))
    for (const s of allSources()) {
      const key = sourceKey(s)
      let c = cursors.get(key) ?? initialCursor(key)
      const rows = (cachedBySource.get(key) ?? []).filter((n) =>
        keptKeys.has(variantKeyOf(n)),
      )
      if (rows.length > 0) {
        // キャッシュで到達点を遡らせるだけで、live の失敗 (バックオフ) は消さない
        const { failures, nextRetryAt } = c
        c = { ...advanceCursor(c, rows), failures, nextRetryAt }
      } else if (
        !liveKeys.has(key) &&
        !live.some((n) => n._accountId === s.accountId)
      ) {
        c = { ...c, exhausted: true }
      }
      setCursor(c)
    }
  }

  /**
   * 列に載せた後の確定。切り詰めで落ちた行を飛ばさないよう、列に残っている行の
   * 最古へ到達点を戻してから水平線を引く (connect の最終マージ専用。以後は
   * nextHorizon で単調に下げるだけ)
   */
  function settleHorizon() {
    const current = rawNotes.value
    for (const c of cursors.values()) {
      // 到達点の無い組は「まだ取っていない」のまま残す。同じアカウントの別の組の
      // 行で付け直すと、その組の最新ページを飛ばす
      if (!c.oldest) continue
      const { accountId } = parseSourceKey(c.key as SourceKey)
      // 行はどの組から来たかを持たない。戻す先は自分の到達点より新しい側だけ
      // (同じアカウントの別の組のもっと古い行まで下げると、間を飛ばす)
      const floor = c.oldest.createdAt
      setCursor(
        reseedFromRows(
          c,
          current.filter(
            (n) => n._accountId === accountId && n.createdAt >= floor,
          ),
        ),
      )
    }
    horizon.value = horizonOf([...cursors.values()])
  }

  /**
   * 水平線のページング (#1184): 底を決めているアカウントだけ 1 ページ遡る。
   * そのアカウントがバックオフ中なら何も取らない (他のアカウントで底を掘り進めると、
   * 隠れた尾が有界でなくなり、復帰後に塊が挟まる)
   */
  async function loadMoreHorizon() {
    if (isLoading.value) return
    const now = Date.now()
    const pick = pickNextAccount([...cursors.values()], now)
    if (!pick) return
    const source = sourceOfKey(pick)
    const acc = accountsStore.accountMap.get(source.accountId)
    const cursor = cursors.get(pick)
    if (!acc || !cursor) return
    isLoading.value = true
    const key = cacheKeyOf(source)
    const gen = generation
    try {
      let raw: NormalizedNote[] = []
      if (acc.hasToken) {
        const adapter = await multiAdapters.getOrCreate(acc.id)
        if (!adapter) throw new Error(`no adapter for ${acc.id}`)
        ensureSubscribed(source, adapter, gen)
        raw = await fetchNotes(
          adapter,
          cursor.oldest ? { untilId: cursor.oldest.id } : undefined,
          source,
        )
      } else if (key && cursor.oldest) {
        raw = await loadCachedTimelineBefore(
          acc.id,
          key,
          cursor.oldest.createdAt,
          cursor.oldest.id,
        )
      }
      if (gen !== generation) return
      setCursor(advanceCursor(cursor, raw))
      // 切り詰めは見えている行で数えるので、載せる前に水平線を下げる
      horizon.value = nextHorizon(horizon.value, [...cursors.values()])
      if (raw.length > 0) {
        const existingKeys = new Set<string>(rawNotes.value.map(variantKeyOf))
        const newOlder = await admit(await dedupAsync(raw, existingKeys))
        if (gen !== generation) return
        if (newOlder.length > 0) {
          setNotes(insertIntoSorted(rawNotes.value, newOlder), 'newest')
        }
      }
    } catch (e) {
      if (gen !== generation) return
      // 1 アカウントの失敗で列ごとエラー画面に替えない。失敗は末尾の区切り行
      // (crossEndState) が「取得できていません」と示し、バックオフ後に再試行する
      // レート制限 (#1271) はサーバーの示す待ち時間に従う
      setCursor(markFailed(cursor, now, rateLimitRetryAfter(e)))
      if (import.meta.env.DEV) console.debug('[cross-account loadMore]', e)
    } finally {
      if (gen === generation) isLoading.value = false
    }
  }

  async function loadMoreCrossAccount() {
    if (horizonPaging) return loadMoreHorizon()
    if (isLoading.value || rawNotes.value.length === 0) return
    isLoading.value = true
    const gen = generation
    const targets = allSources()
    const now = Date.now()

    try {
      // 全組を対象（ログアウト中も含む）。ログイン中は live API で
      // untilId 遡り、ログアウト中は SQLite キャッシュを createdAt で遡る。
      crossProgress.value = { done: 0, total: targets.length }
      await mapWithConcurrency(
        targets,
        async (s) => {
          const key = sourceKey(s)
          const acc = accountsStore.accountMap.get(s.accountId)
          if (!acc) return []
          // 失敗した組はバックオフの間は取らない (他の組は取る)
          const failed = legacyFailures.get(key)
          if (failed && failed.nextRetryAt > now) return []
          // 遡りの位置はカーソル (生ページ基準)。無ければ列に残るそのアカウントの
          // 最古行 (キャッシュだけで出ているアカウント)
          const cursor =
            legacyCursors.get(key) ??
            [...rawNotes.value]
              .reverse()
              .find((n) => n._accountId === s.accountId)

          if (acc.hasToken) {
            const adapter = await multiAdapters.getOrCreate(acc.id)
            if (!adapter) return []
            try {
              const page = await fetchNotes(
                adapter,
                cursor ? { untilId: cursor.id } : undefined,
                s,
              )
              legacyFailures.delete(key)
              advanceLegacyCursor(key, page)
              return page
            } catch (e) {
              // 1 組の失敗で列ごとエラー画面に替えない。次の追加読み込みまで待つ
              legacyFailures.set(
                key,
                markFailed(
                  failed ?? initialCursor(key),
                  now,
                  rateLimitRetryAfter(e),
                ),
              )
              if (import.meta.env.DEV)
                console.debug('[cross-account loadMore]', e)
              return []
            }
          }

          // ログアウト中: hasToken 不要でキャッシュを遡る。
          // createdAt / id は同一ノート由来のペアで渡す (§6-14)
          const cacheKeyForSource = cacheKeyOf(s)
          if (!cacheKeyForSource || !cursor) return []
          try {
            const page = await loadCachedTimelineBefore(
              acc.id,
              cacheKeyForSource,
              cursor.createdAt,
              cursor.id,
            )
            advanceLegacyCursor(key, page)
            return page
          } catch {
            return []
          }
        },
        3,
        // 返ったアカウントの分から順に足す (#1095)。末尾に連結すると、投稿の
        // 多いアカウントの遡り分が他アカウントのもっと古い行より下に付くので、
        // per-account と同じく createdAt 順に差し込む (#1184)
        async (r, _acc, progress) => {
          if (gen !== generation) return
          crossProgress.value = progress
          if (r.status !== 'fulfilled' || !r.value?.length) return
          const existingKeys = new Set<string>(rawNotes.value.map(variantKeyOf))
          const newOlder = await admit(await dedupAsync(r.value, existingKeys))
          if (gen !== generation || newOlder.length === 0) return
          // 下方向のページングなので古い側を残す
          setNotes(insertIntoSorted(rawNotes.value, newOlder), 'newest')
        },
      )
    } catch (e) {
      if (gen === generation) error.value = AppError.from(e)
    } finally {
      // 走行中に connectCrossAccount が始まっていたら、その表示状態を奪わない
      if (gen === generation) {
        isLoading.value = false
        crossProgress.value = null
      }
    }
  }

  function handleScroll() {
    streamingBatch?.handleScroll()
    onScrollReport()
  }

  /**
   * 列の末尾の区切り行の材料 (#1184)。取得できていないアカウントがあればそれを、
   * 無ければ水平線の下に隠れている最初の行 (どのアカウントの、いつの投稿までが
   * 揃っているか) を返す。何も無ければ null (通常の終端)
   */
  const crossEndState = computed<CrossEndState | null>(() => {
    if (!horizonPaging) return null
    void cursorsVersion.value
    const label = (accountId: string) => {
      const a = accountsStore.accountMap.get(accountId)
      return a ? `@${a.username}@${a.host}` : accountId
    }
    // 組を束ねる面では、どのアカウントのどのリソースかまで示す
    const sourceLabel = (key: string) => {
      const s = sourceOfKey(key)
      const who = label(s.accountId)
      return s.name ? `${who} (${s.name})` : who
    }
    const failing = [...cursors.values()].filter(
      (c) => c.failures > 0 && !c.exhausted,
    )
    if (failing.length > 0) {
      return {
        kind: 'failing',
        accounts: failing.map((c) => sourceLabel(c.key)),
      }
    }
    const next = hiddenGroups.value[0]
    if (next) {
      return {
        kind: 'aligned',
        account: label(next.primary._accountId),
        createdAt: next.primary.createdAt,
      }
    }
    return null
  })

  // アカウントの追加・削除、組の変更で対象が変わったら取り直す
  watch(
    () =>
      [
        accountsStore.accounts.map((a) => `${a.id}:${a.hasToken}`).join(','),
        options.sources
          ? normalizeSources(options.sources()).map(sourceKey).join(',')
          : '',
      ].join('|'),
    () => {
      if (isCrossAccount()) connectCrossAccount()
    },
  )

  onMounted(() => {
    if (isCrossAccount()) {
      connectCrossAccount()
    }
  })

  return {
    notes,
    groups,
    noteScrollerRef,
    scrollToTop,
    connectCrossAccount,
    loadMoreCrossAccount,
    crossProgress,
    hiddenGroups,
    crossEndState,
    handleScroll,
    removeNote,
    pendingCount,
    animatingRowKeys,
    onResume,
    // Pull to Refresh (引き下げ枠の描画用)。pullRefresh はテストと明示更新用
    pullRefresh,
    isPulling,
    isPulledEnough,
    isRefreshing,
    pullDistance,
    displayHeight,
    // カラムクエリ (#783): UI 側のバッジ・バナー表示用。filter 未指定なら常に「なし」
    columnQueryState: query?.columnQueryState ?? NO_QUERY_STATE,
    columnQueryErrorCount: query?.queryErrorCount ?? ZERO,
    columnQueryExcludedCount: query?.queryExcludedCount ?? ZERO,
    columnQuerySuspendedKeys: query?.suspendedQueryKeys ?? NO_KEYS,
    columnQuerySuspendedCount: query?.querySuspendedCount ?? ZERO,
    columnQueryMissingIds: query?.missingQueryIds ?? NO_KEYS,
    resumeSuspendedQueries: query?.resumeSuspendedQueries ?? (() => undefined),
    dropMissingQueryRefs: query?.dropMissingQueryRefs ?? (() => undefined),
  }
}

// filter 未指定の面 (メンション / 通知など) が返す定数。reactive でなくてよい
const NO_QUERY_STATE = computed(() => ({
  status: 'none' as const,
  diagnostics: [] as { message: string }[],
  disabled: [] as string[],
}))
const ZERO = ref(0)
const NO_ROW_KEYS: ReadonlySet<string> = new Set()
const NO_KEYS = computed<readonly string[]>(() => [])

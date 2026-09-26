import {
  computed,
  nextTick,
  onMounted,
  onScopeDispose,
  type Ref,
  ref,
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
import { type VariantKey, variantKey, variantKeyOf } from '@/services/noteKey'
import { hasGap } from '@/services/timelineGap'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import { useSystemStateStore } from '@/stores/systemState'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { mapWithConcurrency, type SettleProgress } from '@/utils/concurrency'
import { AppError } from '@/utils/errors'
import { createWorkerClient } from '@/utils/workerClient'
import type { DedupResponse } from '@/workers/dedupWorker'

export interface CrossAccountNotesOptions {
  /** API call to fetch notes for one account */
  fetchNotes: (
    adapter: ServerAdapter,
    opts?: { untilId?: string },
  ) => Promise<NormalizedNote[]>

  /** Whether this is cross-account mode */
  isCrossAccount: () => boolean

  /**
   * Offline cache key (e.g. 'mentions' | 'specified')。指定すると、
   * ログイン中アカウントが無い（全員ログアウト）場合でも全アカウントの
   * SQLite キャッシュを読んで表示する。未指定なら従来通り live のみ。
   */
  cacheKey?: () => string | null

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
    subscribe: (
      accountId: string,
      adapter: ServerAdapter,
      enqueue: (note: NormalizedNote) => void,
      callbacks: { onNoteUpdated: (event: NoteUpdateEvent) => void },
    ) => ChannelSubscription
  }

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

  const list = useNoteList({
    bundle: true,
    getAdapter: () => null,
    visibility: options.visibility,
    closePostForm: options.closePostForm ?? (() => undefined),
    deleteHandler: options.deleteNote,
  })
  const {
    notes,
    groups,
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
        onOverflow: () => {
          toast.show(i18n.ts._useCrossAccountNotes.overflowSkipped, 'warning')
        },
      })
    : null
  /** accountId → 購読。runtime state はカラム単位で共有する */
  const subscriptions = new Map<string, ChannelSubscription>()
  let runtimeState: SubscriptionRuntimeState = 'live'
  const streamHandlers: {
    adapter: ServerAdapter
    event: StreamEventName
    handler: () => void
  }[] = []
  /** connect のたびに進める。古い connect / resume の結果を捨てる */
  let generation = 0
  /** 全アカウント取得の進捗 (#1095)。取得中以外は null */
  const crossProgress = ref<SettleProgress | null>(null)

  function setRuntimeState(state: SubscriptionRuntimeState) {
    runtimeState = state
    for (const sub of subscriptions.values()) {
      ;(sub as Partial<ManagedChannelSubscription>).setRuntimeState?.(state)
    }
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

  function subscribeAccount(accountId: string, adapter: ServerAdapter) {
    if (!streaming || !streamingBatch) return
    subscriptions.get(accountId)?.dispose()
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
    )
    ;(sub as Partial<ManagedChannelSubscription>).setRuntimeState?.(
      runtimeState,
    )
    subscriptions.set(accountId, sub)

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
    if (!ids || ids.size === 0) return new Set()
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
        noteScrollerRef.value.scrollToIndex(0, {
          align: 'start',
          behavior: 'smooth',
        })
      } else {
        scroller.value?.scrollTo({ top: 0, behavior: 'smooth' })
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
        streamingBatch.setPaused(false)
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
    if (rawNotes.value.length === 0) return
    // ウィンドウが隠れている間 (#986) は REST を叩かない (useNoteColumn と同じ)
    if (systemStateStore.adaptation.suspendStreams) return
    const now = Date.now()
    if (now - lastResumeAt < 3000) return
    lastResumeAt = now

    const accounts = accountsStore.accounts.filter((a) => a.hasToken)
    if (accounts.length === 0) return
    const gen = generation
    const results = await mapWithConcurrency(
      accounts,
      async (acc): Promise<[string, NormalizedNote[]]> => {
        const adapter = await multiAdapters.getOrCreate(acc.id)
        if (!adapter) return [acc.id, []]
        try {
          return [acc.id, await fetchNotes(adapter)]
        } catch {
          return [acc.id, []]
        }
      },
      3,
    )
    if (gen !== generation) return

    const current = rawNotes.value
    const gapAccounts = new Set<string>()
    const replacement: NormalizedNote[] = []
    const overlap: NormalizedNote[] = []
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      const [accountId, fetched] = r.value
      const shown = new Set<VariantKey>()
      for (const n of current) {
        if (n._accountId === accountId) shown.add(variantKeyOf(n))
      }
      if (hasGap(fetched, shown, shown.size > 0)) {
        gapAccounts.add(accountId)
        replacement.push(...fetched)
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

  /** 全アカウント（ログアウト済み含む）の SQLite キャッシュを読んで merge する */
  async function loadCrossAccountCache(): Promise<NormalizedNote[]> {
    const key = cacheKey?.()
    if (!key) return []
    const results = await mapWithConcurrency(
      accountsStore.accounts,
      async (acc) => {
        try {
          return await loadCachedTimeline(acc.id, key)
        } catch {
          return []
        }
      },
      3,
    )
    return dedupAsync(collectFulfilled(results))
  }

  async function connectCrossAccount() {
    error.value = null
    isLoading.value = true
    const gen = ++generation
    // 取得中の auto-flush ちらつきを防ぐ。購読は張り直す (TL タブ切替も
    // ここを通るため、旧タブの購読を残さない)
    streamingBatch?.setPaused(true)
    streamingBatch?.resetBatch()
    disposeSubscriptions()

    // オフラインファースト: キャッシュを即時表示（ログアウト中のアカウント分も含む）
    const cached = await loadCrossAccountCache()
    if (gen !== generation) return
    if (cached.length > 0) {
      const admitted = await admit(cached)
      if (gen !== generation) return
      setNotes(admitted)
    }

    const accounts = accountsStore.accounts.filter((a) => a.hasToken)
    // 全アカウントがログアウト中なら live fetch せずキャッシュ表示のみ。
    // キャッシュも無ければ (最後のアカウントを消した等) 表示を空にする —
    // 上の setNotes は空キャッシュで呼ばないので、ここで消さないと削除済み
    // アカウントの行が残る
    if (accounts.length === 0) {
      if (cached.length === 0) setNotes([])
      isLoading.value = false
      return
    }

    try {
      crossProgress.value = { done: 0, total: accounts.length }
      const live: NormalizedNote[] = []
      await mapWithConcurrency(
        accounts,
        async (acc) => {
          const adapter = await multiAdapters.getOrCreate(acc.id)
          if (!adapter) return []
          // capture 用に接続を張る (既に接続済みなら no-op)
          adapter.stream.connect()
          if (gen === generation) subscribeAccount(acc.id, adapter)
          return fetchNotes(adapter)
        },
        3,
        async (r, _acc, progress) => {
          if (gen !== generation) return
          crossProgress.value = progress
          if (r.status !== 'fulfilled' || !r.value) return
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
            const painted = await admit(await dedupAsync([...live, ...cached]))
            if (gen === generation) setNotes(painted)
          }
        },
      )
      if (gen !== generation) return

      // live を優先しつつキャッシュとマージ（dedup は先勝ち）
      const merged = await admit(await dedupAsync([...live, ...cached]))
      if (gen !== generation) return
      setNotes(merged)
    } catch (e) {
      if (gen === generation) error.value = AppError.from(e)
    } finally {
      if (gen === generation) {
        isLoading.value = false
        crossProgress.value = null
        if (wantLive) streamingBatch?.setPaused(false)
      }
    }
  }

  async function loadMoreCrossAccount() {
    if (isLoading.value || rawNotes.value.length === 0) return
    isLoading.value = true
    const key = cacheKey?.()
    const gen = generation

    try {
      // 全アカウントを対象（ログアウト中も含む）。ログイン中は live API で
      // untilId 遡り、ログアウト中は SQLite キャッシュを createdAt で遡る。
      crossProgress.value = { done: 0, total: accountsStore.accounts.length }
      await mapWithConcurrency(
        accountsStore.accounts,
        async (acc) => {
          const lastForAccount = [...rawNotes.value]
            .reverse()
            .find((n) => n._accountId === acc.id)

          if (acc.hasToken) {
            const adapter = await multiAdapters.getOrCreate(acc.id)
            if (!adapter) return []
            if (!lastForAccount) return fetchNotes(adapter)
            return fetchNotes(adapter, { untilId: lastForAccount.id })
          }

          // ログアウト中: hasToken 不要でキャッシュを遡る。
          // createdAt / id は同一ノート (lastForAccount) からペアで渡す (§6-14)
          if (!key || !lastForAccount) return []
          try {
            return await loadCachedTimelineBefore(
              acc.id,
              key,
              lastForAccount.createdAt,
              lastForAccount.id,
            )
          } catch {
            return []
          }
        },
        3,
        // 返ったアカウントの分から順に足す (#1095)。下に足すだけなので
        // 遅いサーバーの分が後から来ても画面は動かない
        async (r, _acc, progress) => {
          if (gen !== generation) return
          crossProgress.value = progress
          if (r.status !== 'fulfilled' || !r.value?.length) return
          const existingKeys = new Set<string>(rawNotes.value.map(variantKeyOf))
          const newOlder = await admit(await dedupAsync(r.value, existingKeys))
          if (gen !== generation || newOlder.length === 0) return
          // 下方向のページングなので古い側を残す
          setNotes([...rawNotes.value, ...newOlder], 'newest')
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

  // アカウントの追加・削除で対象が変わったら取り直す
  watch(
    () => accountsStore.accounts.map((a) => `${a.id}:${a.hasToken}`).join(','),
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
const NO_KEYS = computed<readonly string[]>(() => [])

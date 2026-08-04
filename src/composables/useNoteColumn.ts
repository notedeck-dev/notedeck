import type { Ref } from 'vue'
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type {
  ChannelSubscription,
  NormalizedNote,
  NoteUpdateEvent,
  ServerAdapter,
  TimelineType,
} from '@/adapters/types'
import type { QirQuery } from '@/bindings'
import { useColumnLive } from '@/composables/useColumnMount'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useNavigation } from '@/composables/useNavigation'
import { useNoteCapture } from '@/composables/useNoteCapture'
import {
  loadCachedTimeline,
  loadCachedTimelineBefore,
  purgeStaleCachedNotes,
  searchCachedNotesByQuery,
} from '@/composables/useNoteColumnCache'
import { useNoteFocus } from '@/composables/useNoteFocus'
import { useNoteList } from '@/composables/useNoteList'
import { useNoteScrollerRef } from '@/composables/useNoteScrollerRef'
import { useNoteSound } from '@/composables/useNoteSound'
import type { VisibilityOpts } from '@/composables/useNoteVisibility'
import { usePullToRefresh } from '@/composables/usePullToRefresh'
import { useReadMarker } from '@/composables/useReadMarker'
import * as snapshotStore from '@/composables/useSnapshotStore'
import { useStreamingBatch } from '@/composables/useStreamingBatch'
import {
  type CompileResult,
  compileColumnQuery,
  hashQirQuery,
} from '@/services/columnQuery/compiler'
import { composeQir } from '@/services/columnQuery/composeQir'
import { getSharedDegradedRunner } from '@/services/columnQuery/degradedRunner'
import { evaluateQirQuery } from '@/services/columnQuery/evaluator'
import { isGuestAccount } from '@/stores/accounts'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useStreamInspectorStore } from '@/stores/streamInspector'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { dedup } from '@/utils/dedup'
import { AppError } from '@/utils/errors'
import { logWarn } from '@/utils/logger'
import { readSafeMode } from '@/utils/safeMode'
import { insertIntoSorted } from '@/utils/sortNotes'
import { matchesFilter } from '@/utils/timelineFilter'

/** QIR キャッシュ検索が 1 度に返すノート数 (#783 Phase 3) */
const CACHE_SEARCH_LIMIT = 40
/** 1 度の呼び出しで読む行数の上限。超えたら打ち切ってカーソルを返す */
const CACHE_SEARCH_MAX_SCANNED_ROWS = 2000

/** 🐢 逐次適用へ降格したクエリパーツ (Phase 2)。key はサスペンドの単位 */
interface DegradedPart {
  label: string | null
  key: string
  source: string
}

export interface NoteColumnConfig {
  getColumn: () => DeckColumnType
  fetch: (
    adapter: ServerAdapter,
    opts: { sinceId?: string; untilId?: string },
  ) => Promise<NormalizedNote[]>
  validate?: () => boolean
  cache?: {
    getKey: () => string | null
  }
  streaming?: {
    subscribe: (
      adapter: ServerAdapter,
      enqueue: (n: NormalizedNote) => void,
      callbacks: { onNoteUpdated: (event: NoteUpdateEvent) => void },
    ) => ChannelSubscription
  }
  refreshFetch?: (
    adapter: ServerAdapter,
    currentNotes: NormalizedNote[],
  ) => Promise<{ notes: NormalizedNote[]; mode: 'replace' | 'prepend' }>
  /**
   * クライアント側防御フィルタ。SQLite キャッシュ復元と REST 取得結果の
   * 両方に適用される (ストリーミング挿入はカラム側 subscribe 内で適用)。
   * local/global の public 限定などサーバー応答に依存しない可視性保証 (#651)。
   */
  filterNotes?: (
    notes: NormalizedNote[],
  ) => NormalizedNote[] | Promise<NormalizedNote[]>
  /**
   * dedup レスポンスキャッシュの追加識別子 (例: カラムフィルタの JSON)。
   * 同一アカウント・同一 TL 種別でフィルタ違いのカラムがレスポンスを
   * 共有しないようにする (#651)。
   */
  fetchKey?: () => string
  /**
   * 組込フィルタ (column.filters) の可視性防御層に渡す TL 種別 (#841)。
   * local/global の public 限定はタイムラインカラムのみ意味を持つ
   */
  timelineType?: () => TimelineType | undefined
  /**
   * When provided, delays `connect()` until this ref becomes `true`.
   * Used by timeline columns to wait for policy detection before connecting.
   */
  connectReady?: Ref<boolean>
  /**
   * 表示述語の面別 opt-out（#606）。既定（未指定）は全適用。
   * お気に入り・自分のクリップは `ignoreSuspension`、プロフィールは
   * `ignoreSubject`（面別マトリクスは DEVELOPMENT.md 参照）。
   */
  visibility?: VisibilityOpts
}

export function useNoteColumn(config: NoteColumnConfig) {
  const {
    account,
    columnThemeVars,
    serverIconUrl,
    serverInfoImageUrl,
    serverNotFoundImageUrl,
    serverErrorImageUrl,
    isLoading,
    error,
    initAdapter,
    getAdapter,
    setSubscription,
    disposeSubscription,
    setSubscriptionRuntimeState,
    disconnect,
    onStreamEvent,
    postForm,
    handlers,
    scroller,
    onScrollReport,
  } = useColumnSetup(config.getColumn, {
    isOffline: () => isOffline.value,
  })

  const { navigateToNote } = useNavigation()
  const isStreaming = !!config.streaming

  const {
    notes,
    rawNotes,
    orderedIds,
    noteIds,
    setNotes,
    mergeUpdate,
    setOnNotesChanged,
    onNoteUpdate,
    handlePosted,
    removeNote,
    removingIds,
  } = useNoteList({
    getMyUserId: () => account.value?.userId,
    getAdapter,
    deleteHandler: handlers.delete,
    closePostForm: postForm.close,
    visibility: config.visibility,
    accountId: () => config.getColumn().accountId,
  })

  // Streaming (Group A) or NoteCapture (Group B)
  const noteSound = isStreaming ? useNoteSound(() => account.value?.host) : null
  const myNoteSound = isStreaming
    ? useNoteSound(() => account.value?.host, 'syuilo/n-cea-4va')
    : null
  const toast = useToast()
  const streamingBatch = isStreaming
    ? useStreamingBatch({
        // 書込基底は unfiltered 側。filtered を基底にすると隠れたノートが
        // flush のたびに列から落ちて焼き込まれる（#831 §1.4）
        notes: rawNotes,
        noteIds,
        scroller,
        onNewNotes: (batch) => {
          if (config.getColumn().soundMuted) return
          const myId = account.value?.userId
          const hasMy = myId && batch.some((n) => n.user.id === myId)
          if (hasMy) {
            myNoteSound?.play()
          } else {
            noteSound?.play()
          }
        },
        onOverflow: () => {
          toast.show('新着が多すぎるため一部をスキップしました', 'warning')
        },
      })
    : null

  // Note Capture (subNote/unsubNote) を常に有効にする。
  // streaming カラムでも併用することで、channel subscription が suspend
  // (不可視 8s 経過) されている間も可視ノートの reaction が個別 subNote
  // 経由で届く。channel と capture の二重発火は noteStore.applyUpdate の
  // dedup (noteId × event sig × 1.5s) で吸収される。
  const { sync: syncNoteCapture } = useNoteCapture(
    () => getAdapter()?.stream,
    (event) => onNoteUpdateWithQuery(event),
  )
  setOnNotesChanged(syncNoteCapture)

  // Visibility / budget で 3 段階の挙動をする。
  //   - 不可視: streamingBatch を pause + warm → 8s 後 suspend (Rust 側 unsub)
  //   - 可視・予算外: streamingBatch は pause するが Rust 側 subscription は live のまま。
  //                    こうしないと「画面に見えているのに予算外なだけのカラム」が
  //                    suspend されてしまい、その間の他人のリアクションが永続的に
  //                    取り逃される (suspend 中の noteUpdated を Misskey は再送しない)
  //   - 可視・予算内: 通常通り live, batch flush 再開
  if (streamingBatch) {
    const { isVisible, isLive } = useColumnLive(config.getColumn().id)
    const inspectorStore = useStreamInspectorStore()
    let runtimeTransition = 0
    watch(
      [isVisible, isLive, () => inspectorStore.capturing],
      async ([visible, live, capturing]) => {
        const seq = ++runtimeTransition
        if (!visible) {
          // Stream Inspector 観測中は画面外でも購読を維持し、イベントを
          // buffer に流し続ける（Android 1カラムでの観測を可能にする）。
          // 描画用 batch は止めたまま、Rust 側 subscription だけ live に保つ。
          streamingBatch.setPaused(true)
          setSubscriptionRuntimeState(capturing ? 'live' : 'warm')
          return
        }
        if (!live) {
          // 可視・予算外: subscription は維持してリアクション反映を死守
          streamingBatch.setPaused(true)
          setSubscriptionRuntimeState('live')
          return
        }
        streamingBatch.setPaused(true)
        await onResume()
        if (seq !== runtimeTransition) {
          streamingBatch.setPaused(true)
          return
        }
        setSubscriptionRuntimeState('live')
        streamingBatch.setPaused(false)
      },
      { immediate: true },
    )
  }

  const { focusedNoteId } = useNoteFocus(
    config.getColumn().id,
    notes,
    scroller,
    { ...handlers, delete: removeNote, edit: handlers.edit },
    (note) => navigateToNote(note._accountId, note.id),
    undefined,
    (index) => noteScrollerRef.value?.scrollToIndex(index),
  )

  const pendingCount = streamingBatch?.pendingCount ?? ref(0)
  const animatingIds =
    streamingBatch?.animatingIds ?? shallowRef<ReadonlySet<string>>(new Set())

  /** True when API is unreachable and displaying cached notes */
  const isOffline = ref(false)

  /** True when the account exists but has no auth token */
  const isLoggedOut = computed(() => account.value?.hasToken === false)

  /**
   * Read marker: viewMarkerId points to the note that was topmost at the
   * time of the last unmount. Notes ABOVE it are new since last visit.
   * Sticky for this session — does not move as new notes stream in.
   */
  const { viewMarkerId } = useReadMarker(
    config.getColumn().id,
    () => notes.value[0]?.id ?? null,
  )

  // --- カラムクエリ (#783 層 2) ---
  // カラム設定の noteQuery (インライン式) + noteQueryRefs (名前付きクエリ参照)
  // を QIR にコンパイルし、全取り込み経路 (キャッシュ復元 / REST / ページング /
  // streaming / refresh) で同期評価する。合成は And (仕様追補 B)。
  // 層 1 述語 (isHidden) は表示 computed 側で、合成は「!isHidden && query」
  // (#831 の縫い目)。組込 filterNotes とは AND 合成 (組込が先 = 最安)。
  const columnQueriesStore = useColumnQueriesStore()
  const compiledQuery = computed(() => {
    // セーフモード時はカラムクエリを無いものとして扱う (#838 条件 3)。
    // コンパイルしない・Worker を起動しない・QIR キャッシュ検索に入らない・
    // フィルタなしで表示 (fail-open)。プラグインと同じ「自動実行される
    // ユーザーコードを止める」意味論。評価時に読むのはテスト容易性のため
    if (readSafeMode()) return null
    const col = config.getColumn()
    const inline = col.noteQuery?.trim() ? col.noteQuery : null
    const refs = col.noteQueryRefs ?? []
    if (!inline && refs.length === 0) return null
    // ⚡ = QIR で同期評価、🐢 = Worker で逐次適用 (Phase 2)、拒否 = fail-closed
    const fast: { label: string | null; query: QirQuery }[] = []
    const degraded: DegradedPart[] = []
    const rejected: { label: string | null; result: CompileResult }[] = []
    // 参照消失 (削除・未導入) は捨てず fail-closed (仕様追補 A)
    const missing: string[] = []

    function classify(label: string | null, key: string, src: string): void {
      const result = compileColumnQuery(src)
      if (result.ok) {
        fast.push({ label, query: result.query })
      } else if (result.degradable) {
        degraded.push({ label, key, source: src })
      } else {
        rejected.push({ label, result })
      }
    }

    if (inline) classify(null, `${col.id}:inline`, inline)
    for (const id of refs) {
      const named = columnQueriesStore.getQuery(id)
      if (!named) {
        missing.push(id)
        continue
      }
      // key は名前付きクエリ id。同じクエリを使う全カラムでサスペンドを共有する
      classify(named.name, id, named.src)
    }
    return { fast, degraded, rejected, missing }
  })
  /** per-note エラーの診断計上 (V14: エラー = 除外 + 計上) */
  const queryErrorCount = ref(0)
  /** クエリで除外したノート数 (空状態の「TL が空」との区別表示用) */
  const queryExcludedCount = ref(0)
  /** 暴走で打ち切られサスペンド中のフィルタ (「N 件保留中」表示用) */
  const suspendedQueryKeys = shallowRef<readonly string[]>([])
  /** サスペンド中に判定できず取り込めなかった件数 */
  const querySuspendedCount = ref(0)

  const columnQueryState = computed(() => {
    const compiled = compiledQuery.value
    if (!compiled) {
      // セーフモードでクエリを止めているカラムは、止まっていることが見えないと
      // 「もともとクエリを設定していないカラム」と区別がつかない (#971)。
      // クエリの主用途は「見たくないものを隠す」ことなので、停止が黙って
      // 起きると隠していたものが予告なく表示に戻る。fail-open は維持する。
      const col = config.getColumn()
      const hasQuery =
        !!col.noteQuery?.trim() || (col.noteQueryRefs ?? []).length > 0
      if (hasQuery && readSafeMode()) {
        return { status: 'safeMode' as const, diagnostics: [] }
      }
      return { status: 'none' as const, diagnostics: [] }
    }
    const diagnostics: { message: string }[] = []
    for (const id of compiled.missing) {
      diagnostics.push({
        message: `参照している名前付きクエリ (${id}) が見つかりません`,
      })
    }
    for (const part of compiled.rejected) {
      const prefix = part.label ? `${part.label}: ` : ''
      for (const d of part.result.ok ? [] : part.result.diagnostics) {
        diagnostics.push({ message: `${prefix}${d.message}` })
      }
    }
    if (diagnostics.length > 0) {
      return { status: 'invalid' as const, diagnostics }
    }
    // 🐢: 逐次適用に降格しているカラム (インデックス検索は使えない)
    if (compiled.degraded.length > 0) {
      return { status: 'degraded' as const, diagnostics: [] }
    }
    return { status: 'active' as const, diagnostics: [] }
  })

  /**
   * ⚡ パーツ (QIR) だけの同期判定。🐢 パーツは Worker が要るのでここでは見ない。
   * 取り込み経路はまずこれで短絡し、生き残りだけを Worker に回す。
   */
  function queryAdmitsFast(note: NormalizedNote): boolean {
    const compiled = compiledQuery.value
    if (!compiled) return true
    // 参照消失・拒否されたクエリの残留は fail-closed (不変条件 (f))
    if (columnQueryState.value.status === 'invalid') return false
    // And 合成: 全部 match のときだけ表示 (短絡)。error = 除外 + 計上
    for (const part of compiled.fast) {
      const verdict = evaluateQirQuery(part.query, note)
      if (verdict === 'match') continue
      if (verdict === 'error') queryErrorCount.value++
      queryExcludedCount.value++
      return false
    }
    return true
  }

  /**
   * 🐢 パーツを Worker で評価する (Phase 2c)。⚡ で生き残ったノートだけが対象。
   * 評価不能 (サスペンド・タイムアウト) は error = 除外 + 計上で、カラムは
   * fail-closed のまま新着が積まれない状態になる (不変条件 (f))。
   */
  async function admitDegraded(
    notes: NormalizedNote[],
  ): Promise<NormalizedNote[]> {
    const compiled = compiledQuery.value
    if (!compiled || compiled.degraded.length === 0 || notes.length === 0) {
      return notes
    }
    const runner = getSharedDegradedRunner()
    const outcome = await runner.run(
      compiled.degraded.map((d) => ({ key: d.key, source: d.source })),
      notes,
    )
    suspendedQueryKeys.value = compiled.degraded
      .map((d) => d.key)
      .filter((key) => runner.isSuspended(key))
    const isSuspended = suspendedQueryKeys.value.length > 0
    const admitted: NormalizedNote[] = []
    outcome.verdicts.forEach((verdict, i) => {
      const note = notes[i]
      if (note === undefined) return
      if (verdict === 'match') {
        admitted.push(note)
        return
      }
      // サスペンド中は全件が error で返る。評価できていないだけなので
      // 「保留」に数え、評価エラー・除外には積まない (積むとバッジの
      // エラー件数が停止している間ずっと増え続ける)
      if (isSuspended) {
        querySuspendedCount.value++
        return
      }
      if (verdict === 'error') queryErrorCount.value++
      queryExcludedCount.value++
    })
    return admitted
  }

  /**
   * QIR キャッシュ検索に使えるクエリ (#783 Phase 3)。
   *
   * ⚡ パーツのみで構成されるカラムに限る (🐢 パーツは QIR を持たない)。
   * 複数 ⚡ は let スロットを renumber したうえで And 合成する (#965)。
   * 該当しないカラムは従来どおり「キャッシュから読んでフロントで絞る」
   * 経路を通る。
   */
  function cacheSearchableQuery(): QirQuery | null {
    const compiled = compiledQuery.value
    if (!compiled) return null
    if (compiled.degraded.length > 0 || compiled.rejected.length > 0)
      return null
    if (compiled.missing.length > 0) return null
    if (compiled.fast.length === 0) return null
    return composeQir(compiled.fast.map((f) => f.query))
  }

  /** 参照先が消えた名前付きクエリの id (削除・未導入)。fail-closed の原因 */
  const missingQueryIds = computed(() => compiledQuery.value?.missing ?? [])

  /**
   * 消えたクエリへの参照をこのカラムから外す。
   *
   * 参照は自動では掃除しない (再導入で復帰させたい・黙ってフィルタが外れるのを
   * 避けたい、仕様追補 A) が、外す手段が無いと fail-closed から抜け出せない。
   * フィルタメニューは存在するクエリしか列挙しないので、ここが唯一の導線になる。
   */
  function dropMissingQueryRefs(): void {
    const col = config.getColumn()
    const missing = new Set(missingQueryIds.value)
    const refs = (col.noteQueryRefs ?? []).filter((id) => !missing.has(id))
    useDeckStore().updateColumn(col.id, {
      noteQueryRefs: refs.length > 0 ? refs : undefined,
    })
  }

  /**
   * サスペンドを解除して取り込みを再開する (V15 の明示再開)。
   * 自動では戻さない — 暴走したクエリを黙って走らせ直さないため。
   */
  function resumeSuspendedQueries(): void {
    const runner = getSharedDegradedRunner()
    for (const key of suspendedQueryKeys.value) runner.resume(key)
    suspendedQueryKeys.value = []
    querySuspendedCount.value = 0
    void refresh()
  }

  /** 合成クエリの実効シグネチャ (dedup キーと変更検知を兼ねる)。 */
  const querySignature = computed(() => {
    const compiled = compiledQuery.value
    if (!compiled) return ''
    if (columnQueryState.value.status === 'invalid') {
      return `invalid:${compiled.missing.join(',')}`
    }
    return [
      ...compiled.fast.map((p) => hashQirQuery(p.query)),
      // 🐢 パーツは QIR を持たないのでソースそのものを署名に混ぜる
      ...compiled.degraded.map((d) => `slow:${d.key}:${d.source.length}`),
    ].join('+')
  })

  /** クエリ変更の世代。遅れて返った再適用が新しい状態を壊さないためのガード */
  let querySignatureGeneration = 0

  // クエリ変更時 (インライン編集・トグル・named の編集伝播): 診断をリセットし、
  // 表示中ノートへ即時適用 (絞り込み方向) + refetch (緩和方向の回収)
  watch(querySignature, (next, prev) => {
    if (next === prev) return
    queryErrorCount.value = 0
    queryExcludedCount.value = 0
    const generation = ++querySignatureGeneration
    // 再適用と refetch は直列に流す。並行にすると、🐢 の Worker 待ちで遅れた
    // 再適用が refetch の結果を「変更前のクエリで絞った列」で上書きしてしまう
    // (fail-closed 中は空列なので、解除した瞬間に一覧が消える)
    void (async () => {
      if (rawNotes.value.length > 0) {
        const filtered = await applyQueryFilter(rawNotes.value)
        if (generation !== querySignatureGeneration) return
        setNotes(filtered)
      }
      if (generation !== querySignatureGeneration) return
      // 再適用で列が空になっていても取り直す。ストリーミングカラムの
      // catch-up は「ノートが 1 件も無ければ API を叩かない」ので、
      // force なしだと空のまま次のストリームイベントまで埋まらない (#957)
      await refresh({ force: true })
    })()
  })

  async function applyQueryFilter(
    incoming: NormalizedNote[],
  ): Promise<NormalizedNote[]> {
    if (!compiledQuery.value) return incoming
    return admitDegraded(incoming.filter((n) => queryAdmitsFast(n)))
  }

  /**
   * streaming 挿入にも組込フィルタ + クエリを適用する (enqueue 前段、V13/V22)。
   *
   * ⚡ だけのカラムは同期のまま即 enqueue する。🐢 パーツがあるカラムは
   * 判定が非同期になるので、判定待ちバッファへ積んで hold-and-release する。
   */
  function enqueueWithQuery(n: NormalizedNote): void {
    if (!builtinAdmits(n)) return
    if (!queryAdmitsFast(n)) return
    if ((compiledQuery.value?.degraded.length ?? 0) === 0) {
      streamingBatch?.enqueueNote(n)
      return
    }
    holdForDegraded(n)
  }

  // --- 判定待ちバッファ (hold-and-release, V22) ---
  // 到着順を保つため、バッチは 1 本ずつ直列に流す。判定が終わったものから
  // 順に enqueue するので、Worker の応答が前後しても表示順は入れ替わらない。
  let heldNotes: NormalizedNote[] = []
  let holdFlush: Promise<void> | null = null

  function holdForDegraded(n: NormalizedNote): void {
    heldNotes.push(n)
    // 実行中なら積むだけ。flush 側のループが同じバッファを拾って続ける
    if (holdFlush !== null) return
    holdFlush = flushHeldNotes().finally(() => {
      holdFlush = null
    })
  }

  async function flushHeldNotes(): Promise<void> {
    while (heldNotes.length > 0) {
      const batch = heldNotes
      heldNotes = []
      const admitted = await admitDegraded(batch)
      for (const note of admitted) streamingBatch?.enqueueNote(note)
    }
  }

  /** 判定待ちのまま削除されたノートを捨てる (removePending と同じ役割) */
  function dropHeldNote(noteId: string): void {
    heldNotes = heldNotes.filter((n) => n.id !== noteId)
  }

  /**
   * ノート更新イベント後の再評価 (V24)。表示中ノートが更新でクエリ条件を
   * 外れたら即除去する (例: reactions を見るクエリ)。逆方向 (外 → 内) は
   * 挿入しない — 取得経路を通っていないノートは位置が定まらない (追補 C-7)。
   * 本文編集はライブイベントが無く、refetch 経路の applyFilter が担う。
   */
  function onNoteUpdateWithQuery(event: NoteUpdateEvent): void {
    onNoteUpdate(event)
    if (!compiledQuery.value || event.type === 'deleted') return
    void nextTick(async () => {
      const note = rawNotes.value.find((n) => n.id === event.noteId)
      if (!note) return
      if (!queryAdmitsFast(note)) {
        setNotes(rawNotes.value.filter((n) => n.id !== event.noteId))
        return
      }
      const admitted = await admitDegraded([note])
      if (admitted.length === 0) {
        setNotes(rawNotes.value.filter((n) => n.id !== event.noteId))
      }
    })
  }

  // --- 組込フィルタ (#841) ---
  // カラム設定の filters (リノート/リプライ/ファイル付き/Bot) を全ノートカラム
  // 共通でクライアント側適用する。タイムラインは API パラメータでも絞るが、
  // antenna/channel/user 等の REST は filters を受けないためここが唯一の適用点
  function builtinAdmits(note: NormalizedNote): boolean {
    return matchesFilter(
      note,
      config.getColumn().filters,
      config.timelineType?.(),
    )
  }

  const filtersSignature = computed(() =>
    JSON.stringify(config.getColumn().filters ?? null),
  )

  // フィルタ変更時: 絞り込み方向は表示中ノートへ即時適用、緩和方向は refetch で回収
  // (クエリシグネチャ watch と同じパターン)
  watch(filtersSignature, (next, prev) => {
    if (next === prev) return
    if (rawNotes.value.length > 0) {
      setNotes(rawNotes.value.filter((n) => builtinAdmits(n)))
    }
    void refresh()
  })

  /**
   * Apply builtin filters + filterNotes if configured (組込が先 = 最安)。
   * 🐢 カラムでは Worker 判定を挟むので非同期になる (V22)。
   *
   * 仕様 (V22) は「同期フック契約は ⚡ 専用」としているが、実装では ⚡ 側も
   * 含めて経路を async に統一した。同期/非同期を呼び出し元 6 箇所で分岐させる
   * 複雑さに対して、⚡ カラムで増えるのがマイクロタスク数周分でしかないため。
   * ⚡ の判定そのものは同期のまま (queryAdmitsFast) で Worker は起きない。
   */
  async function applyFilter(
    incoming: NormalizedNote[],
  ): Promise<NormalizedNote[]> {
    const builtin = incoming.filter((n) => builtinAdmits(n))
    const base = config.filterNotes
      ? await config.filterNotes(builtin)
      : builtin
    return applyQueryFilter(base)
  }

  /**
   * フェッチカーソル（#831 §1.4）。取り込んだ「生ページ」（applyFilter 前）の
   * 最古ノートを保持し、ページングの位置決めに使う。
   *
   * バッファ末尾を位置決めに使うと、ページが丸ごとフィルタで落ちたとき位置が
   * 前進せず、loadMore が同じページを取り続ける無限ループになる。カーソルは
   * 落ちたノートも含めて前進するため、この同型のループが構造的に消える。
   */
  const fetchCursor = shallowRef<{ id: string; createdAt: string } | null>(null)

  function oldestOf(page: NormalizedNote[]): NormalizedNote | null {
    let oldest: NormalizedNote | null = null
    for (const n of page) {
      if (!oldest || n.createdAt < oldest.createdAt) oldest = n
    }
    return oldest
  }

  /**
   * 単調前進: 取り込んだページの最古が現カーソルより古いときだけ更新する。
   * pullRefresh / resume の最新側ページでカーソルが新しい方向へ戻ることを禁止。
   */
  function advanceFetchCursor(page: NormalizedNote[]): void {
    const oldest = oldestOf(page)
    if (!oldest) return
    const cur = fetchCursor.value
    if (cur && oldest.createdAt >= cur.createdAt) return
    fetchCursor.value = { id: oldest.id, createdAt: oldest.createdAt }
  }

  /**
   * バッファを全置換する操作（reconnect / gap catch-up / タブ切替 / 非
   * streaming の refresh）で呼ぶ。旧世代カーソルが残ると、新バッファと旧
   * カーソルの間がページングでサイレントにスキップされる。
   */
  function resetFetchCursor(page: NormalizedNote[] = []): void {
    fetchCursor.value = null
    advanceFetchCursor(page)
  }

  /**
   * 非同期フェッチ中にタブ (cache key) が切り替わったら結果を破棄するための
   * ガード。フェッチ開始時に呼んで capture し、await 後に返り値で検査する (#651)。
   */
  function tabGuard(): () => boolean {
    const key = config.cache?.getKey() ?? 'default'
    return () => (config.cache?.getKey() ?? 'default') === key
  }

  /** Load and filter cached timeline notes. Returns empty array on failure. */
  async function loadFilteredCache(label: string): Promise<NormalizedNote[]> {
    const column = config.getColumn()
    const cacheKey = config.cache?.getKey()
    if (!column.accountId || !cacheKey) return []
    try {
      const cached = await loadCachedTimeline(column.accountId, cacheKey)
      advanceFetchCursor(cached)
      return await applyFilter(cached)
    } catch (e) {
      logWarn(label, e)
      return []
    }
  }

  // --- Shared stage helpers ---

  /**
   * Split incoming notes into existing (in-place update) and brand-new (enqueue for animation).
   * For non-streaming columns, falls back to simple mergeUpdate.
   * When `replace` is true, replaces all notes instead of merging (initial load without cache).
   */
  function mergeOrEnqueue(
    incoming: NormalizedNote[],
    opts?: { replace?: boolean },
  ): void {
    if (incoming.length === 0) return
    if (opts?.replace) {
      setNotes(incoming)
      // 全置換なので旧世代カーソルは捨てる。置換ページ自体を新カーソルに
      // 据える（フィルタ後の最古なので生ページより新しい側に寄りうるが、
      // 取りこぼしは生まない）
      resetFetchCursor(incoming)
      return
    }
    if (streamingBatch) {
      const existing = incoming.filter((n) => noteIds.has(n.id))
      const brandNew = incoming.filter((n) => !noteIds.has(n.id))
      if (existing.length > 0) mergeUpdate(existing)
      if (brandNew.length > 0) {
        streamingBatch.addQueued(brandNew)
        // 最上部にいるときだけ即 flush する。スクロール中はバナー表示に
        // 留め、勝手に最上部へ戻さない (#791)
        if (streamingBatch.isAtTop.value) scrollToTop()
      }
    } else {
      mergeUpdate(incoming)
    }
  }

  /**
   * 最新ページと表示中ノートの重なりで 1 ページ超の欠落を判定する (#791)。
   * 重なりゼロ = 最新ページの最古ですら表示中の先頭より新しい。マージすると
   * 間に隠れた穴が残るため、呼び出し側は最新ページで丸ごと置換する
   * (古いノートはスクロールで再取得可能)。復帰 (onResume)・タブ切替
   * (switchWithSnapshot)・手動リロード (refresh) 共通の catch-up 判定。
   */
  function hasGap(fetched: NormalizedNote[], hadNotes: boolean): boolean {
    return (
      hadNotes && fetched.length > 0 && !fetched.some((n) => noteIds.has(n.id))
    )
  }

  function getDedupKey(): string {
    const fetchKey = config.fetchKey ? `:${config.fetchKey()}` : ''
    // クエリ違いのカラム間でレスポンスキャッシュを共有しない (#783 V13)。
    // 合成クエリは全構成要素のハッシュ連結 (named の編集も fetchKey を変える)
    const queryKey = querySignature.value ? `:q=${querySignature.value}` : ''
    return `${config.getColumn().accountId}:${config.cache?.getKey() ?? 'default'}${fetchKey}${queryKey}`
  }

  async function fetchAndDedup(
    adapter: ServerAdapter,
    opts: { sinceId?: string } = {},
  ): Promise<NormalizedNote[]> {
    const fetched = await dedup(getDedupKey(), () =>
      config.fetch(adapter, opts),
    )
    advanceFetchCursor(fetched)
    // REST 取得もキャッシュ・ストリーミングと同じ防御フィルタを通す (#651)
    return applyFilter(fetched)
  }

  function verifyStaleNotes(
    adapter: ServerAdapter,
    cachedIds: string[],
    freshIds: Set<string>,
  ): void {
    const accountId = config.getColumn().accountId
    if (cachedIds.length === 0 || !accountId) return
    const unverified = cachedIds.filter((id) => !freshIds.has(id))
    if (unverified.length > 0) {
      purgeStaleCachedNotes(
        adapter,
        unverified,
        () => !!getAdapter(),
        accountId,
      )
    }
  }

  async function handleFetchError(
    e: unknown,
    tryCacheFallback = false,
  ): Promise<void> {
    if (notes.value.length > 0) {
      isOffline.value = true
      return
    }
    if (tryCacheFallback) {
      const filtered = await loadFilteredCache('fallback-cache')
      if (filtered.length > 0) {
        setNotes(filtered)
        isOffline.value = true
        return
      }
    }
    error.value = AppError.from(e)
  }

  // Handle token state transitions (logout / re-login)
  watch(
    () => account.value?.hasToken,
    async (hasToken, prev) => {
      if (prev === true && hasToken === false) {
        // Logout: stop streaming, preserve displayed notes (freeze)
        disconnect()
      } else if (prev === false && hasToken === true) {
        // Re-login: reconnect with full authentication
        reconnect()
      }
    },
  )

  async function connect(useCache = false) {
    error.value = null

    if (config.validate && !config.validate()) {
      return
    }

    const stillCurrent = tabGuard()

    // Restore snapshot from a previously unmounted instance (instant re-mount)
    const colId = config.getColumn().id
    const cacheKey = config.cache?.getKey()
    const snapshot = cacheKey
      ? snapshotStore.restoreAndConsume(colId, cacheKey)
      : null
    if (snapshot) {
      setNotes(snapshot.notes)
      resetFetchCursor(snapshot.notes)
      const { scrollTop: savedScrollTop, anchor } = snapshot
      nextTick(() => {
        // アンカー (note id) 基準で復元し、仮想スクローラの再測定による
        // ピクセルずれジャンプを防ぐ。見つからなければ scrollTop にフォールバック
        const restored = anchor
          ? (noteScrollerRef.value?.restoreScrollAnchor?.(
              anchor.id,
              anchor.offset,
            ) ?? false)
          : false
        if (!restored) {
          const el = noteScrollerRef.value?.getElement?.()
          if (el) el.scrollTop = savedScrollTop
        }
      })
    }

    // Load cache when explicitly requested OR when account has no token
    const shouldLoadCache =
      (useCache || !account.value || !account.value.hasToken) && config.cache

    // Show cache immediately (non-blocking) so the user sees content while API fetches
    const cachePromise = shouldLoadCache
      ? loadFilteredCache('load-cache')
      : Promise.resolve([] as NormalizedNote[])

    // Display cached notes as soon as they arrive (don't wait for API)
    const cachedNotes = await cachePromise
    if (!stillCurrent()) return
    let cachedIds: string[] = []
    if (cachedNotes.length > 0) {
      setNotes(cachedNotes)
      cachedIds = cachedNotes.map((n) => n.id)
    }

    // Only show skeleton if no cached notes are available
    if (notes.value.length === 0) {
      isLoading.value = true
    }

    // Unresolved account: show cached notes in read-only mode
    if (!account.value) {
      isOffline.value = true
      isLoading.value = false
      return
    }

    // App-level offline mode: skip API fetch and streaming, show cache only
    if (useOfflineModeStore().isOfflineMode) {
      isOffline.value = true
      isLoading.value = false
      return
    }

    // Logged-out account: show cached notes only, skip API fetch.
    // Guest accounts (never authenticated) still use anonymous API.
    if (!account.value.hasToken && !isGuestAccount(account.value)) {
      isLoading.value = false
      return
    }

    try {
      const adapter = await initAdapter({ hasToken: account.value.hasToken })
      if (!adapter) return

      // Start streaming setup early (runs in parallel with API fetch below).
      // Combined commands handle connect + subscribe in a single IPC round-trip.
      // Skip streaming for logged-out/guest accounts.
      if (account.value.hasToken && config.streaming && streamingBatch) {
        // Pause streaming to prevent auto-flush flicker while API fetch is pending
        streamingBatch.setPaused(true)
        adapter.stream.connect()
        let wasDisconnected = false
        onStreamEvent('disconnected', () => {
          isOffline.value = true
          wasDisconnected = true
        })
        onStreamEvent('reconnecting', () => {
          isOffline.value = true
          wasDisconnected = true
        })
        onStreamEvent('connected', () => {
          isOffline.value = false
          // WS 瞬断からの再接続時、切断中に欠けたノートを埋める (#704 K)。
          // 初回接続では発火しない。onResume は 3 秒スロットル内蔵で冪等
          if (wasDisconnected) {
            wasDisconnected = false
            void onResume()
          }
        })
        setSubscription(
          config.streaming.subscribe(adapter, enqueueWithQuery, {
            onNoteUpdated: (event) => {
              if (event.type === 'deleted') {
                streamingBatch.removePending(event.noteId)
                // 判定待ちのまま消えたノートを取り込まない
                dropHeldNote(event.noteId)
              }
              onNoteUpdateWithQuery(event)
            },
          }),
        )
        noteSound?.warmup()
      }

      // Fetch fresh data from API (runs after cache is already displayed)
      const hasCached = cachedIds.length > 0
      // 同期位置の決定は unfiltered 基底で読む（隠れた先頭ノートを飛ばさない）
      const sinceId =
        !hasCached && rawNotes.value.length > 0
          ? rawNotes.value[0]?.id
          : undefined
      const fetched = await fetchAndDedup(adapter, sinceId ? { sinceId } : {})
      // フェッチ中にタブが切り替わっていたら旧タブの結果を破棄 (#651)
      if (!stillCurrent()) return
      const freshIds = new Set(fetched.map((n) => n.id))

      if (fetched.length > 0) {
        mergeOrEnqueue(fetched, {
          replace: !hasCached && !sinceId,
        })
      }

      isOffline.value = false
      verifyStaleNotes(adapter, cachedIds, freshIds)
    } catch (e) {
      await handleFetchError(e, true)
    } finally {
      // Resume streaming after initial data is displayed
      streamingBatch?.setPaused(false)
      isLoading.value = false
    }
  }

  /**
   * 下方向ページングの書込 (#834)。
   *
   * 列は新しい順なので、保持上限に達した状態で古いノートを足すと、既定の
   * 切り捨て (古い側を捨てる) が足したばかりのノートをそのまま捨ててしまい、
   * それ以上遡れなくなる。ページング時は逆に新しい側を捨てる。
   *
   * 上端から要素が消えるとスクロール位置が飛ぶため、NoteScroller の id 基準
   * アンカーで見た目の位置を維持する。ページング発火時点の先頭可視ノートは
   * 捨てられる新しい側より下にあるので、アンカーは基本的に生き残る。
   */
  async function setNotesPaged(merged: NormalizedNote[]): Promise<void> {
    const anchor = noteScrollerRef.value?.getScrollAnchor?.() ?? null
    setNotes(merged, 'newest')
    // 実際に上限で削られたときだけ補正する (削られていなければ位置は動かない)
    const dropped = merged.length - rawNotes.value.length
    if (!anchor || dropped <= 0) return
    await nextTick()
    noteScrollerRef.value?.restoreScrollAnchor?.(anchor.id, anchor.offset)
  }

  /**
   * QIR キャッシュ検索の 1 パス (#783 Phase 3)。
   *
   * fetchCursor より古い側を走査上限まで遡り、条件に合うノートを見つけて
   * カラムへ取り込む。「40 件読んで全部フィルタで落ちる」空振りをここで
   * 吸収する。オフラインの loadMoreFromCache と、オンライン loadMore の
   * 空振りチェーン (#964) が共用する。
   */
  async function runCacheSearchPass(
    searchable: QirQuery,
    stillCurrent: () => boolean,
  ): Promise<void> {
    const column = config.getColumn()
    const cacheKey = config.cache?.getKey()
    if (!column.accountId || !cacheKey) return
    const cursor = fetchCursor.value
      ? {
          createdAt: fetchCursor.value.createdAt,
          noteId: fetchCursor.value.id,
        }
      : null
    // カラムの所属バケットで母集合を絞る (notecli#30 §12-9 で妥協解消)
    const found = await searchCachedNotesByQuery(
      column.accountId,
      searchable,
      cacheKey,
      cursor,
      CACHE_SEARCH_LIMIT,
      CACHE_SEARCH_MAX_SCANNED_ROWS,
    )
    if (!stillCurrent()) return
    queryErrorCount.value += found.errors
    if (found.cursor) {
      // 走査上限で打ち切った位置から次回続ける
      fetchCursor.value = {
        id: found.cursor.noteId,
        createdAt: found.cursor.createdAt,
      }
    } else {
      advanceFetchCursor(found.notes)
    }
    if (found.notes.length > 0) {
      await setNotesPaged(insertIntoSorted(rawNotes.value, found.notes))
    }
  }

  /** Helper to load older notes from SQLite cache */
  async function loadMoreFromCache() {
    const column = config.getColumn()
    const cacheKey = config.cache?.getKey()
    if (!column.accountId || !cacheKey) return
    // createdAt ベースのページングなのでアンカーもカーソルの createdAt を使う。
    // 全件フィルタ落ちのページでもアンカーが前進し、API 経路と同型のループが
    // キャッシュ経路に残らない。
    // createdAt と id は必ず同一ソースからペアで取る — 食い違うと keyset
    // cursor (sort_key, note_id) が別ノート由来になり遡りが破綻する (§6-14)
    const cursorSource = fetchCursor.value ?? rawNotes.value.at(-1)
    const anchor = cursorSource?.createdAt
    if (!cursorSource || !anchor) return
    const stillCurrent = tabGuard()
    isLoading.value = true
    try {
      const searchable = cacheSearchableQuery()
      if (searchable) {
        await runCacheSearchPass(searchable, stillCurrent)
        return
      }
      const older = await loadCachedTimelineBefore(
        column.accountId,
        cacheKey,
        anchor,
        cursorSource.id,
      )
      if (!stillCurrent()) return
      advanceFetchCursor(older)
      const filtered = await applyFilter(older)
      if (filtered.length > 0) {
        await setNotesPaged(insertIntoSorted(rawNotes.value, filtered))
      }
    } catch (e) {
      logWarn('load-more-cache', e)
    } finally {
      isLoading.value = false
    }
  }

  async function loadMore() {
    // 空ガードは「まだ 1 ページも取っていない」の意。初回ページが全件フィルタ
    // 落ちでもカーソルが立っていれば続きを取りに行ける
    if (isLoading.value) return
    if (fetchCursor.value == null && rawNotes.value.length === 0) return
    if (config.validate && !config.validate()) return

    // Offline: load from cache instead
    if (isOffline.value) {
      await loadMoreFromCache()
      return
    }

    const adapter = getAdapter()
    if (!adapter) return
    const untilId = fetchCursor.value?.id ?? rawNotes.value.at(-1)?.id
    if (!untilId) return
    const stillCurrent = tabGuard()
    isLoading.value = true
    try {
      const older = await config.fetch(adapter, { untilId })
      if (!stillCurrent()) return
      advanceFetchCursor(older)
      const filtered = await applyFilter(older)
      await setNotesPaged(insertIntoSorted(rawNotes.value, filtered))
      if (filtered.length === 0) {
        // API ページは取れたがフィルタ後の獲得が 0 (ページ自体が空も含む)。
        // オンラインでもキャッシュ検索を 1 パスだけチェーンしてカラムを
        // 埋める (#964)。1 回の loadMore につきチェーンは 1 回まで。
        // 二重読みにならない理由: この API ページは api_get_timeline 経由で
        // ingest 済みで、キャッシュ検索は fetchCursor (直前の
        // advanceFetchCursor で API ページの最古まで前進済み) より古い側
        // だけを走査するため。
        const searchable = cacheSearchableQuery()
        if (searchable && stillCurrent()) {
          await runCacheSearchPass(searchable, stillCurrent)
        }
      }
    } catch (e) {
      logWarn('load-more', e)
      isOffline.value = true
      await loadMoreFromCache()
    } finally {
      isLoading.value = false
    }
  }

  function handleScroll() {
    streamingBatch?.handleScroll()
    onScrollReport()
  }

  function scrollToTop() {
    streamingBatch?.flushToTop()
    nextTick(() => {
      if (noteScrollerRef.value) {
        noteScrollerRef.value.scrollToIndex(0, {
          align: 'start',
          behavior: 'smooth',
        })
      } else if (scroller.value) {
        scroller.value.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }

  async function refresh(opts?: { force?: boolean }) {
    if (isStreaming) {
      // ストリーミングカラムのリロードボタン: 復帰 catch-up と同じ経路で
      // 最新ページを取得し gap 判定する。手動操作なのでスロットルは無視 (#791)
      lastResumeAt = 0
      await onResume(opts)
      return
    }
    const adapter = getAdapter()
    if (!adapter || isLoading.value) return
    if (config.validate && !config.validate()) return
    isLoading.value = true
    error.value = null
    try {
      if (config.refreshFetch) {
        const result = await config.refreshFetch(adapter, rawNotes.value)
        // refreshFetch 経路にも組込フィルタ + カラムクエリを適用する
        // (#783 全取り込み経路 / #841)
        const refreshed = await applyFilter(result.notes)
        if (result.mode === 'replace') {
          setNotes(refreshed)
          resetFetchCursor(refreshed)
          scrollToTop()
        } else if (refreshed.length > 0) {
          setNotes(insertIntoSorted(rawNotes.value, refreshed))
          scrollToTop()
        }
      } else {
        const fetched = await config.fetch(adapter, {})
        setNotes(await applyFilter(fetched))
        resetFetchCursor(fetched)
        scrollToTop()
      }
      isOffline.value = false
    } catch (e) {
      if (notes.value.length > 0) {
        isOffline.value = true
      } else {
        error.value = AppError.from(e)
      }
    } finally {
      isLoading.value = false
    }
  }

  async function pullRefresh() {
    const adapter = getAdapter()
    if (!adapter) return
    if (config.validate && !config.validate()) return
    const sinceId = rawNotes.value[0]?.id
    const stillCurrent = tabGuard()
    try {
      const fetched = await fetchAndDedup(adapter, sinceId ? { sinceId } : {})
      if (!stillCurrent()) return
      if (fetched.length > 0) mergeUpdate(fetched)
      isOffline.value = false
    } catch (e) {
      logWarn('pull-refresh', e)
      isOffline.value = true
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

  let lastResumeAt = 0

  async function onResume(opts?: { force?: boolean }) {
    const adapter = getAdapter()
    if (!adapter || !account.value) return
    if (config.validate && !config.validate()) return

    const now = Date.now()
    if (now - lastResumeAt < 3000) return
    lastResumeAt = now

    const hadNotes = rawNotes.value.length > 0
    // クエリ変更のように「今は空だが取り直したい」場合に判定を迂回する。
    // hadNotes は本来「まだ 1 ページも取っていない = 初回接続が担うので
    // catch-up 不要」を見るためのもので、一時的に空になった列には当たらない
    const shouldFetch = hadNotes || opts?.force === true
    const stillCurrent = tabGuard()

    // Run cache fetch and API fetch in parallel. Fetch the LATEST page (not
    // { sinceId }): while suspended the channel is unsubscribed and Misskey does
    // not resend, so the missed range can exceed one page. A sinceId merge would
    // splice in a partial page and leave a hidden hole. Fetching latest lets us
    // detect a gap and replace cleanly instead of silently dropping notes (#506).
    const cachePromise =
      isStreaming && config.cache
        ? loadFilteredCache('resume-cache')
        : Promise.resolve([] as NormalizedNote[])

    let apiFailed = false
    const apiPromise = shouldFetch
      ? fetchAndDedup(adapter, {}).catch((e) => {
          logWarn('resume-api', e)
          apiFailed = true
          return [] as NormalizedNote[]
        })
      : Promise.resolve([] as NormalizedNote[])

    const [cached, fetched] = await Promise.all([cachePromise, apiPromise])
    // フェッチ中にタブが切り替わっていたら旧タブの結果を破棄 (#651)。
    // ガードなしだと下の gap 判定が別 TL のページで発火し、カラム全体が
    // 期待外の公開範囲のノートに丸ごと置換される。
    if (!stillCurrent()) return
    isOffline.value = apiFailed

    if (hasGap(fetched, hadNotes)) {
      mergeOrEnqueue(fetched, { replace: true })
      return
    }

    // Merge: update existing in-place, route new notes through streaming batch
    mergeOrEnqueue([...fetched, ...cached])

    // Background: verify cached notes not confirmed by fresh API fetch
    if (cached.length > 0) {
      const freshIds = new Set(fetched.map((n) => n.id))
      verifyStaleNotes(
        adapter,
        cached.map((n) => n.id),
        freshIds,
      )
    }
  }

  /**
   * Re-subscribe to streaming channel without destroying the adapter/stream.
   * Reuses the existing WebSocket connection — only the channel subscription changes.
   */
  function resubscribe(adapter: ServerAdapter) {
    if (!config.streaming || !streamingBatch) return
    disposeSubscription()
    streamingBatch.resetBatch()
    setSubscription(
      config.streaming.subscribe(adapter, enqueueWithQuery, {
        onNoteUpdated: (event) => {
          if (event.type === 'deleted')
            streamingBatch.removePending(event.noteId)
          onNoteUpdateWithQuery(event)
        },
      }),
    )
  }

  /** Disconnect, reset, and reconnect with fresh config state */
  async function reconnect(useCache = false) {
    const adapter = getAdapter()
    const stillCurrent = tabGuard()
    if (useOfflineModeStore().isOfflineMode) {
      // Offline mode: load cache only, skip API fetch and streaming
      setNotes([])
      resetFetchCursor()
      isLoading.value = true
      if (useCache && config.cache) {
        const filtered = await loadFilteredCache('reconnect-cache')
        if (stillCurrent() && filtered.length > 0) setNotes(filtered)
      }
      isOffline.value = true
      isLoading.value = false
    } else if (adapter && config.streaming && streamingBatch) {
      // Stream-preserving path: reuse adapter/WebSocket, swap subscription only
      streamingBatch.setPaused(true)
      resubscribe(adapter)
      setNotes([])
      resetFetchCursor()
      error.value = null
      isLoading.value = true
      try {
        // Load cache if requested
        if (useCache && config.cache) {
          const filtered = await loadFilteredCache('reconnect-cache')
          if (!stillCurrent()) return
          if (filtered.length > 0) setNotes(filtered)
        }
        // Fetch latest from API
        const fetched = await fetchAndDedup(adapter)
        // フェッチ中にタブが切り替わっていたら旧タブの結果を破棄 (#651)
        if (!stillCurrent()) return
        mergeOrEnqueue(fetched)
        isOffline.value = false
      } catch (e) {
        await handleFetchError(e)
      } finally {
        streamingBatch.setPaused(false)
        isLoading.value = false
      }
    } else {
      // Full reconnect: no adapter yet (initial connection, logged-out, etc.)
      disconnect()
      streamingBatch?.resetBatch()
      setNotes([])
      resetFetchCursor()
      await connect(useCache)
    }
  }

  /** Switch tab with pre-loaded snapshot — swaps subscription without touching stream */
  async function switchWithSnapshot(
    snapshotNotes: NormalizedNote[],
    scrollTop: number,
    anchor: snapshotStore.ScrollAnchor | null = null,
  ) {
    const adapter = getAdapter()
    if (!adapter || !config.streaming || !streamingBatch) {
      // Fallback to full reconnect if no adapter
      await reconnect(true)
      return
    }

    // Pause streaming to prevent auto-flush flicker during snapshot transition
    streamingBatch.setPaused(true)
    const stillCurrent = tabGuard()
    // 以降は必ず paused を解除して抜ける。await を finally の外に置くと、
    // フィルタ評価 (Worker / filterNotes) の失敗でストリームが止まったままになる
    try {
      // Swap subscription (stream/WebSocket stays connected)
      resubscribe(adapter)
      // snapshot は可視性を焼き込まない unfiltered な ID 列 (#574) なので、
      // 取り込み時フィルタ (組込フィルタ + カラムクエリ) は復元側で通す。
      // 通さないと、タブを離れている間にクエリを厳しくしても切替先には旧列が
      // 残り、隠したはずのノートが見えてしまう
      try {
        setNotes(await applyFilter(snapshotNotes))
      } catch (e) {
        // フィルタを通せない列は出さない (fail-closed)。呼び出し元の
        // onTabChange は await していないので、ここで throw させない
        logWarn('snapshot-filter', e)
        setNotes([])
      }
      // カーソルは生ページ基準 (フィルタで落ちた分も含めて前進させる)
      resetFetchCursor(snapshotNotes)
      error.value = null
      await nextTick()
      const restored = anchor
        ? (noteScrollerRef.value?.restoreScrollAnchor?.(
            anchor.id,
            anchor.offset,
          ) ?? false)
        : false
      if (!restored && scroller.value) scroller.value.scrollTop = scrollTop

      // Sync isAtTop with restored scroll position (resetBatch forces it to true)
      streamingBatch.isAtTop.value = scrollTop <= 10

      // Snapshot 更新は { sinceId } ではなく最新ページを取得する。sinceId だと
      // 1 ページ分しか埋まらず、snapshot が古い (長期スリープ後など) と隠れた
      // 穴が残る。onResume と同じく gap を検出して置換する (#791)
      try {
        const fetched = await fetchAndDedup(adapter, {})
        // Guard: discard if tab changed during async fetch
        if (!stillCurrent()) return
        const gap = hasGap(fetched, snapshotNotes.length > 0)
        mergeOrEnqueue(fetched, gap ? { replace: true } : undefined)
        isOffline.value = false
      } catch {
        // API failure with snapshot displayed — mark offline
        isOffline.value = true
      }
    } finally {
      // Resume streaming after transition is complete
      streamingBatch.setPaused(false)
    }
  }

  const uiStore = useUiStore()
  watch(
    () => uiStore.deckResumeSignal,
    () => onResume(),
  )

  // Non-streaming columns: watch cache-key invalidation signal (clip/favorites mutations)
  if (!isStreaming && config.cache) {
    const { columnInvalidation } = useDeckStore()
    const cacheConfig = config.cache
    watch(
      () => {
        const key = cacheConfig.getKey()
        return key ? columnInvalidation[key] : undefined
      },
      () => refresh(),
    )
  }

  onMounted(() => {
    if (config.connectReady && !config.connectReady.value) {
      // Delay connect until the parent signals readiness (e.g. policy detection)
      const stop = watch(config.connectReady, (ready) => {
        if (ready) {
          stop()
          connect(true)
        }
      })
    } else {
      connect(true)
    }
  })

  onUnmounted(() => {
    // Save snapshot for instant restore if column is re-mounted
    const unmountCacheKey = config.cache?.getKey()
    if (orderedIds.value.length > 0 && unmountCacheKey) {
      const el = noteScrollerRef.value?.getElement?.()
      // unfiltered な orderedIds を保存（可視性は復帰後に述語で再適用）
      snapshotStore.save(
        config.getColumn().id,
        unmountCacheKey,
        orderedIds.value,
        el?.scrollTop ?? 0,
        noteScrollerRef.value?.getScrollAnchor?.() ?? null,
      )
    }
    disconnect()
    streamingBatch?.resetBatch()
  })

  const { noteScrollerRef } = useNoteScrollerRef(scroller)

  return {
    account,
    columnThemeVars,
    serverIconUrl,
    serverInfoImageUrl,
    serverNotFoundImageUrl,
    serverErrorImageUrl,
    isLoading,
    isOffline,
    isLoggedOut,
    viewMarkerId,
    error,
    // カラムクエリ (#783): UI 側のバッジ・診断表示用
    columnQueryState,
    columnQueryErrorCount: queryErrorCount,
    columnQueryExcludedCount: queryExcludedCount,
    /** 暴走で打ち切られサスペンド中のクエリ (fail-closed 中のカラムを示す) */
    columnQuerySuspendedKeys: suspendedQueryKeys,
    columnQuerySuspendedCount: querySuspendedCount,
    resumeSuspendedQueries,
    columnQueryMissingIds: missingQueryIds,
    dropMissingQueryRefs,
    notes,
    orderedIds,
    focusedNoteId,
    pendingCount,
    animatingIds,
    postForm,
    handlers,
    noteScrollerRef,
    scroller,
    scrollToTop,
    handleScroll,
    handlePosted,
    removeNote,
    removingIds,
    loadMore,
    refresh,
    isPulling,
    isPulledEnough,
    isRefreshing,
    pullDistance,
    displayHeight,
    // Low-level API for columns needing direct control (e.g. timeline type switching, time machine)
    connect,
    disconnect,
    reconnect,
    switchWithSnapshot,
    setNotes,
  }
}

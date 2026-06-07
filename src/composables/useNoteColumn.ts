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
} from '@/adapters/types'
import { useColumnLive } from '@/composables/useColumnMount'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useNavigation } from '@/composables/useNavigation'
import { useNoteCapture } from '@/composables/useNoteCapture'
import {
  loadCachedTimeline,
  loadCachedTimelineBefore,
  purgeStaleCachedNotes,
} from '@/composables/useNoteColumnCache'
import { useNoteFocus } from '@/composables/useNoteFocus'
import { useNoteList } from '@/composables/useNoteList'
import { useNoteScrollerRef } from '@/composables/useNoteScrollerRef'
import { useNoteSound } from '@/composables/useNoteSound'
import { usePullToRefresh } from '@/composables/usePullToRefresh'
import { useReadMarker } from '@/composables/useReadMarker'
import * as snapshotStore from '@/composables/useSnapshotStore'
import { useStreamingBatch } from '@/composables/useStreamingBatch'
import { isGuestAccount } from '@/stores/accounts'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { dedup } from '@/utils/dedup'
import { AppError } from '@/utils/errors'
import { logWarn } from '@/utils/logger'
import { insertIntoSorted } from '@/utils/sortNotes'

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
  /** Filter cached notes after loading from SQLite (e.g. timeline column filters) */
  filterCachedNotes?: (notes: NormalizedNote[]) => NormalizedNote[]
  /**
   * When provided, delays `connect()` until this ref becomes `true`.
   * Used by timeline columns to wait for policy detection before connecting.
   */
  connectReady?: Ref<boolean>
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
    orderedIds,
    noteIds,
    setNotes,
    mergeUpdate,
    setOnNotesChanged,
    onNoteUpdate,
    handlePosted,
    removeNote,
  } = useNoteList({
    getMyUserId: () => account.value?.userId,
    getAdapter,
    deleteHandler: handlers.delete,
    closePostForm: postForm.close,
  })

  // Streaming (Group A) or NoteCapture (Group B)
  const noteSound = isStreaming ? useNoteSound(() => account.value?.host) : null
  const myNoteSound = isStreaming
    ? useNoteSound(() => account.value?.host, 'syuilo/n-cea-4va')
    : null
  const toast = useToast()
  const streamingBatch = isStreaming
    ? useStreamingBatch({
        notes,
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
    onNoteUpdate,
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
    let runtimeTransition = 0
    watch(
      [isVisible, isLive],
      async ([visible, live]) => {
        const seq = ++runtimeTransition
        if (!visible) {
          streamingBatch.setPaused(true)
          setSubscriptionRuntimeState('warm')
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

  /** Apply filterCachedNotes if configured */
  function applyFilter(cached: NormalizedNote[]): NormalizedNote[] {
    return config.filterCachedNotes ? config.filterCachedNotes(cached) : cached
  }

  /** Load and filter cached timeline notes. Returns empty array on failure. */
  async function loadFilteredCache(label: string): Promise<NormalizedNote[]> {
    const column = config.getColumn()
    const cacheKey = config.cache?.getKey()
    if (!column.accountId || !cacheKey) return []
    try {
      const cached = await loadCachedTimeline(column.accountId, cacheKey)
      return applyFilter(cached)
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
      return
    }
    if (streamingBatch) {
      const existing = incoming.filter((n) => noteIds.has(n.id))
      const brandNew = incoming.filter((n) => !noteIds.has(n.id))
      if (existing.length > 0) mergeUpdate(existing)
      if (brandNew.length > 0) {
        streamingBatch.addQueued(brandNew)
        scrollToTop()
      }
    } else {
      mergeUpdate(incoming)
    }
  }

  function getDedupKey(): string {
    return `${config.getColumn().accountId}:${config.cache?.getKey() ?? 'default'}`
  }

  async function fetchAndDedup(
    adapter: ServerAdapter,
    opts: { sinceId?: string } = {},
  ): Promise<NormalizedNote[]> {
    return dedup(getDedupKey(), () => config.fetch(adapter, opts))
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

    // Restore snapshot from a previously unmounted instance (instant re-mount)
    const colId = config.getColumn().id
    const cacheKey = config.cache?.getKey()
    const snapshot = cacheKey
      ? snapshotStore.restoreAndConsume(colId, cacheKey)
      : null
    if (snapshot) {
      setNotes(snapshot.notes)
      const savedScrollTop = snapshot.scrollTop
      nextTick(() => {
        const el = noteScrollerRef.value?.getElement?.()
        if (el) el.scrollTop = savedScrollTop
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
        onStreamEvent('disconnected', () => {
          isOffline.value = true
        })
        onStreamEvent('reconnecting', () => {
          isOffline.value = true
        })
        onStreamEvent('connected', () => {
          isOffline.value = false
        })
        setSubscription(
          config.streaming.subscribe(adapter, streamingBatch.enqueueNote, {
            onNoteUpdated: (event) => {
              if (event.type === 'deleted')
                streamingBatch.removePending(event.noteId)
              onNoteUpdate(event)
            },
          }),
        )
        noteSound?.warmup()
      }

      // Fetch fresh data from API (runs after cache is already displayed)
      const hasCached = cachedIds.length > 0
      const sinceId =
        !hasCached && notes.value.length > 0 ? notes.value[0]?.id : undefined
      const fetched = await fetchAndDedup(adapter, sinceId ? { sinceId } : {})
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

  /** Helper to load older notes from SQLite cache */
  async function loadMoreFromCache() {
    const column = config.getColumn()
    const cacheKey = config.cache?.getKey()
    if (!column.accountId || !cacheKey) return
    const lastNote = notes.value.at(-1)
    if (!lastNote) return
    isLoading.value = true
    try {
      const older = await loadCachedTimelineBefore(
        column.accountId,
        cacheKey,
        lastNote.createdAt,
      )
      const filtered = applyFilter(older)
      if (filtered.length > 0) {
        setNotes(insertIntoSorted(notes.value, filtered))
      }
    } catch (e) {
      logWarn('load-more-cache', e)
    } finally {
      isLoading.value = false
    }
  }

  async function loadMore() {
    if (isLoading.value || notes.value.length === 0) return
    if (config.validate && !config.validate()) return

    // Offline: load from cache instead
    if (isOffline.value) {
      await loadMoreFromCache()
      return
    }

    const adapter = getAdapter()
    if (!adapter) return
    const lastNote = notes.value.at(-1)
    if (!lastNote) return
    isLoading.value = true
    try {
      const older = await config.fetch(adapter, { untilId: lastNote.id })
      setNotes(insertIntoSorted(notes.value, older))
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

  async function refresh() {
    if (isStreaming) return
    const adapter = getAdapter()
    if (!adapter || isLoading.value) return
    if (config.validate && !config.validate()) return
    isLoading.value = true
    error.value = null
    try {
      if (config.refreshFetch) {
        const result = await config.refreshFetch(adapter, notes.value)
        if (result.mode === 'replace') {
          setNotes(result.notes)
          scrollToTop()
        } else if (result.notes.length > 0) {
          setNotes(insertIntoSorted(notes.value, result.notes))
          scrollToTop()
        }
      } else {
        const fetched = await config.fetch(adapter, {})
        setNotes(fetched)
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
    const sinceId = notes.value[0]?.id
    try {
      const fetched = await fetchAndDedup(adapter, sinceId ? { sinceId } : {})
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

  async function onResume() {
    const adapter = getAdapter()
    if (!adapter || !account.value) return
    if (config.validate && !config.validate()) return

    const now = Date.now()
    if (now - lastResumeAt < 3000) return
    lastResumeAt = now

    const sinceId = notes.value[0]?.id

    // Run cache fetch and API fetch in parallel
    const cachePromise =
      isStreaming && config.cache
        ? loadFilteredCache('resume-cache')
        : Promise.resolve([] as NormalizedNote[])

    let apiFailed = false
    const apiPromise = sinceId
      ? fetchAndDedup(adapter, { sinceId }).catch((e) => {
          logWarn('resume-api', e)
          apiFailed = true
          return [] as NormalizedNote[]
        })
      : Promise.resolve([] as NormalizedNote[])

    const [cached, fetched] = await Promise.all([cachePromise, apiPromise])
    isOffline.value = apiFailed

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
      config.streaming.subscribe(adapter, streamingBatch.enqueueNote, {
        onNoteUpdated: (event) => {
          if (event.type === 'deleted')
            streamingBatch.removePending(event.noteId)
          onNoteUpdate(event)
        },
      }),
    )
  }

  /** Disconnect, reset, and reconnect with fresh config state */
  async function reconnect(useCache = false) {
    const adapter = getAdapter()
    if (useOfflineModeStore().isOfflineMode) {
      // Offline mode: load cache only, skip API fetch and streaming
      setNotes([])
      isLoading.value = true
      if (useCache && config.cache) {
        const filtered = await loadFilteredCache('reconnect-cache')
        if (filtered.length > 0) setNotes(filtered)
      }
      isOffline.value = true
      isLoading.value = false
    } else if (adapter && config.streaming && streamingBatch) {
      // Stream-preserving path: reuse adapter/WebSocket, swap subscription only
      streamingBatch.setPaused(true)
      resubscribe(adapter)
      setNotes([])
      error.value = null
      isLoading.value = true
      try {
        // Load cache if requested
        if (useCache && config.cache) {
          const filtered = await loadFilteredCache('reconnect-cache')
          if (filtered.length > 0) setNotes(filtered)
        }
        // Fetch latest from API
        const fetched = await fetchAndDedup(adapter)
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
      await connect(useCache)
    }
  }

  /** Switch tab with pre-loaded snapshot — swaps subscription without touching stream */
  async function switchWithSnapshot(
    snapshotNotes: NormalizedNote[],
    scrollTop: number,
  ) {
    const adapter = getAdapter()
    if (!adapter || !config.streaming || !streamingBatch) {
      // Fallback to full reconnect if no adapter
      await reconnect(true)
      return
    }

    // Pause streaming to prevent auto-flush flicker during snapshot transition
    streamingBatch.setPaused(true)

    // Swap subscription (stream/WebSocket stays connected)
    resubscribe(adapter)
    setNotes(snapshotNotes)
    error.value = null
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scrollTop

    // Sync isAtTop with restored scroll position (resetBatch forces it to true)
    streamingBatch.isAtTop.value = scrollTop <= 10

    // Fetch diff from API to update snapshot with latest data
    const sinceId = snapshotNotes[0]?.id
    const snapshotCacheKey = config.cache?.getKey() ?? 'default'
    try {
      const fetched = await fetchAndDedup(adapter, sinceId ? { sinceId } : {})
      // Guard: discard if tab changed during async fetch
      if ((config.cache?.getKey() ?? 'default') !== snapshotCacheKey) return
      // Snapshot already has existing notes — only enqueue brand-new ones
      mergeOrEnqueue(fetched)
      isOffline.value = false
    } catch {
      // API failure with snapshot displayed — mark offline
      isOffline.value = true
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

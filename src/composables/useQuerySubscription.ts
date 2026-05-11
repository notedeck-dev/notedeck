import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { registerQuery, unregisterQuery } from '@/aiscript/events'
import {
  events,
  type JsonValue,
  type QueryRuntimeState,
  type QuerySnapshot,
} from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

export interface UseQuerySubscriptionOptions {
  /** Opens the query and returns its snapshot (queryId, etc.). Called once on mount. */
  open: () => Promise<QuerySnapshot>
  /**
   * When provided, the query's runtime state is synchronized with this ref.
   * `true` → live, `false` → suspended (with no warm grace period).
   */
  isLive?: () => boolean
  /** Item id limit applied to the initial snapshot. Defaults to backend's MAX_READ_MODEL_ITEMS. */
  limit?: number
}

/**
 * Subscribe to a Rust-side QueryRuntime read model.
 *
 * Read model は note 本体ではなく **id list** を返す。note 本体は JS 側の
 * noteStore (src/stores/notes.ts) が唯一の真実で、ここでは順序情報のみを扱う。
 * delta event は依然として note 本体を inserts に乗せて流すので、消費側は
 * 受け取った insert を noteStore に put し、当 composable から得た itemIds で
 * 表示順序を駆動する想定。
 *
 * Lifecycle:
 *  1. `open()` is called → returns the queryId
 *  2. Initial snapshot (id list) is fetched via `query_get_read_model_snapshot`
 *  3. `query-delta` events update itemIds incrementally (newer ids prepended)
 *  4. Suspended → Live で復帰したときは Rust 側 recent_ids が空なので、snapshot
 *     を再フェッチして空配列で reset する。表示は noteStore + 各カラム自身の
 *     orderedIds が維持しているため UI は崩れず、新規 delta のみが流入する。
 *  5. On dispose → `query_close` releases the subscription
 *
 * The composable trusts `revision` to drop out-of-order deltas.
 */
export function useQuerySubscription(opts: UseQuerySubscriptionOptions) {
  const itemIds = shallowRef<string[]>([])
  const revision = ref(0)
  const queryId = ref<string | null>(null)
  const ready = ref(false)

  let disposed = false
  let unlistenDelta: (() => void) | null = null

  function applyInsert(insert: JsonValue) {
    const id = idOf(insert)
    if (id === null) return
    itemIds.value = [id, ...itemIds.value.filter((i) => i !== id)]
  }

  function applyDelete(deleteId: string) {
    itemIds.value = itemIds.value.filter((i) => i !== deleteId)
  }

  async function loadSnapshot() {
    const id = queryId.value
    if (!id) return
    const snap = unwrap(
      await commands.queryGetReadModelSnapshot(id, opts.limit ?? null),
    )
    if (disposed || queryId.value !== id) return
    if (!snap) return
    if (snap.revision < revision.value) return
    itemIds.value = snap.itemIds
    revision.value = snap.revision
    ready.value = true
  }

  ;(async () => {
    let snapshot: QuerySnapshot
    try {
      snapshot = await opts.open()
    } catch (e) {
      console.error('[query-subscription] open failed:', e)
      return
    }
    if (disposed) {
      commands.queryClose(snapshot.queryId).catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[query-subscription] late close ignored:', e)
      })
      return
    }

    queryId.value = snapshot.queryId
    revision.value = snapshot.revision
    // Nd:on('note:new' / 'notification:new') の queryDelta fan-out 用に
    // queryId -> {flavor, accountId} マップを更新する。
    registerQuery(snapshot.queryId, snapshot.key)

    unlistenDelta = await events.queryDelta.listen((event) => {
      if (disposed) return
      const delta = event.payload
      if (delta.queryId !== queryId.value) return
      if (delta.revision <= revision.value) return
      for (const insert of delta.inserts) applyInsert(insert)
      for (const id of delta.deletes) applyDelete(id)
      revision.value = delta.revision
    })
    if (disposed) {
      unlistenDelta?.()
      return
    }

    await loadSnapshot()
  })()

  if (opts.isLive) {
    const isLiveFn = opts.isLive
    watch(
      () => isLiveFn(),
      async (live, prev) => {
        const id = queryId.value
        if (!id) return
        const state: QueryRuntimeState = live ? 'live' : 'suspended'
        try {
          await commands.querySetRuntimeState(id, state)
        } catch (e) {
          if (import.meta.env.DEV)
            console.debug('[query-subscription] setRuntimeState failed:', e)
          return
        }
        if (live && prev === false) {
          // Suspended → Live: Rust 側 recent_ids は空にされている。snapshot 再取得で
          // itemIds を空にリセットし、以降は新規 delta だけが流入する。表示は
          // noteStore + 各カラムの orderedIds 側で維持される。
          itemIds.value = []
          revision.value = 0
          ready.value = false
          await loadSnapshot()
        }
      },
      { flush: 'post' },
    )
  }

  onScopeDispose(() => {
    disposed = true
    unlistenDelta?.()
    unlistenDelta = null
    const id = queryId.value
    if (id) {
      unregisterQuery(id)
      commands.queryClose(id).catch((e) => {
        console.warn('[query-subscription] close failed:', e)
      })
    }
  })

  return { itemIds, revision, queryId, ready }
}

function idOf(item: JsonValue): string | null {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return null
  }
  const id = (item as Record<string, JsonValue>).id
  return typeof id === 'string' ? id : null
}

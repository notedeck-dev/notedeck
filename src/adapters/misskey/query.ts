import type {
  ManagedChannelSubscription,
  NoteUpdateEvent,
  SubscriptionRuntimeState,
} from '@/adapters/types'
import type { JsonValue, NoteUpdate, QuerySnapshot } from '@/bindings'
import { onQueryDelta } from '@/core/queryDeltaBus'
import { commands } from '@/utils/tauriInvoke'

export interface CreateQuerySubscriptionOptions {
  /** Opens the query and returns its snapshot. Called once. */
  open: () => Promise<QuerySnapshot>
  /** Called for every item in delta.inserts. */
  onInsert: (item: JsonValue) => void
  /** Called for every id in delta.deletes. */
  onDelete?: (id: string) => void
  /** Called for every partial note update (reaction / pollVoted etc.) in delta.updates. */
  onUpdate?: (event: NoteUpdateEvent) => void
}

/**
 * Bridge from Rust QueryRuntime delta stream to a ChannelSubscription-shaped
 * handle. The handle behaves like a regular streaming subscription so it can
 * be returned from `NoteColumnConfig.streaming.subscribe()` without changing
 * `useNoteColumn`.
 *
 * Lifecycle:
 *  1. open() resolves → store queryId
 *  2. onQueryDelta (queryDeltaBus) → fan out inserts/deletes filtered by queryId
 *  3. dispose() → unlisten + queryClose
 *
 * `setRuntimeState()` maps live/warm/suspended to `query_set_runtime_state`,
 * which in turn drives Rust-side stream subscription suspend/resume.
 */
export function createQuerySubscription(
  opts: CreateQuerySubscriptionOptions,
): ManagedChannelSubscription {
  let queryId: string | null = null
  let disposed = false
  let runtimeState: SubscriptionRuntimeState = 'live'
  let unlistenDelta: (() => void) | null = null
  let lastRevision = 0
  // 下流の channel subscription id (= stream event payload.subscriptionId)。
  // open 解決まで null。Stream Inspector のカラム別フィルタで使う。
  let sourceSubscriptionId: string | null = null
  let resolveReady!: () => void
  const ready = new Promise<void>((r) => {
    resolveReady = r
  })

  ;(async () => {
    // open() は WS 接続 + 購読作成を含み、起動直後 (ネットワーク未確立 /
    // バックエンド初期化中) は失敗しうる。一発死させると WS が後で復活
    // しても Rust 側に購読が存在せず replay 対象にならないため、notecli の
    // 再接続ループと同じ Equal Jitter バックオフで成功するまで再試行する。
    let snap: QuerySnapshot | null = null
    let backoffMs = 1000
    const BACKOFF_CAP_MS = 30_000
    while (!disposed) {
      try {
        snap = await opts.open()
        break
      } catch (e) {
        console.error('[query-subscription] open failed (retrying):', e)
        const jittered = backoffMs / 2 + Math.random() * (backoffMs / 2)
        await new Promise((r) => setTimeout(r, jittered))
        backoffMs = Math.min(backoffMs * 2, BACKOFF_CAP_MS)
      }
    }
    if (!snap) {
      // disposed by unmount while retrying
      resolveReady()
      return
    }
    if (disposed) {
      commands.queryClose(snap.queryId).catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[query-subscription] late close ignored:', e)
      })
      resolveReady()
      return
    }
    queryId = snap.queryId
    lastRevision = snap.revision
    sourceSubscriptionId = snap.sourceSubscriptionId
    resolveReady()

    unlistenDelta = onQueryDelta((delta) => {
      if (disposed) return
      if (delta.queryId !== queryId) return
      if (delta.revision <= lastRevision) return
      for (const insert of delta.inserts) opts.onInsert(insert)
      if (opts.onDelete) {
        for (const id of delta.deletes) opts.onDelete(id)
      }
      if (opts.onUpdate) {
        for (const u of delta.updates) opts.onUpdate(toNoteUpdateEvent(u))
      }
      lastRevision = delta.revision
    })

    if (runtimeState !== 'live' && queryId) {
      commands.querySetRuntimeState(queryId, runtimeState).catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[query-subscription] initial setRuntimeState:', e)
      })
    }
  })()

  function toNoteUpdateEvent(u: NoteUpdate): NoteUpdateEvent {
    return {
      noteId: u.noteId,
      type: u.updateType as NoteUpdateEvent['type'],
      body: (u.body ?? {}) as NoteUpdateEvent['body'],
    }
  }

  return {
    get subscriptionId() {
      return sourceSubscriptionId
    },
    whenReady: () => ready,
    dispose: () => {
      if (disposed) return
      disposed = true
      unlistenDelta?.()
      unlistenDelta = null
      if (queryId) {
        commands.queryClose(queryId).catch((e) => {
          console.warn('[query-subscription] close failed:', e)
        })
        queryId = null
      }
    },
    setRuntimeState: (state) => {
      if (disposed) return
      if (runtimeState === state) return
      runtimeState = state
      if (queryId) {
        commands.querySetRuntimeState(queryId, state).catch((e) => {
          if (import.meta.env.DEV)
            console.debug('[query-subscription] setRuntimeState failed:', e)
        })
      }
    },
  }
}

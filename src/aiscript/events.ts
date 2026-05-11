/**
 * `Nd:on` で AiScript プラグインに公開する NoteDeck 内部イベントのファサード。
 *
 * Tauri event を raw で露出すると将来の改名・情報漏洩リスクが大きいため、
 * 公開イベント名と payload subset を NoteDeck 側で明示的に定義する。
 *
 * Phase 1 で提供する 4 種類:
 *   - account:switch — アクティブアカウントが切り替わったとき
 *   - column:added — 新しいカラムがデッキに追加されたとき
 *   - column:removed — カラムがデッキから削除されたとき
 *   - streaming:status — accountId 単位の接続状態が変化したとき
 *
 * `note:new` / `notification:new` は queryDelta の query kind 抽象化と
 * 一緒に Phase 2 で追加予定。
 */

import { watch } from 'vue'
import { events, type JsonValue, type QueryKey } from '@/bindings'
import { useAccountsStore } from '@/stores/accounts'
import { useDeckStore } from '@/stores/deck'
import { type OnlineStatus, useStreamingStore } from '@/stores/streaming'

export type NoteDeckEventName =
  | 'account:switch'
  | 'column:added'
  | 'column:removed'
  | 'streaming:status'
  | 'note:new'
  | 'notification:new'

export const SUPPORTED_EVENT_NAMES: readonly NoteDeckEventName[] = [
  'account:switch',
  'column:added',
  'column:removed',
  'streaming:status',
  'note:new',
  'notification:new',
]

export type EventPayload = Record<string, unknown>
export type EventHandler = (payload: EventPayload) => void
export type Unsubscribe = () => void

interface ColumnSnapshot {
  id: string
  type: string
  name: string | null
  accountId: string | null
}

/**
 * column の id 集合と現在のカラム配列から「追加された / 削除された」を計算する。
 * Pinia なしで単独テストできるよう純関数として切り出している。
 */
export function diffColumns(
  prev: ReadonlySet<string>,
  current: readonly ColumnSnapshot[],
): {
  added: ColumnSnapshot[]
  removedIds: string[]
  next: Set<string>
} {
  const next = new Set(current.map((c) => c.id))
  const added = current.filter((c) => !prev.has(c.id))
  const removedIds: string[] = []
  for (const id of prev) {
    if (!next.has(id)) removedIds.push(id)
  }
  return { added, removedIds, next }
}

/**
 * streaming 状態の前後差分から変化のあった (accountId, status) ペアを返す。
 */
export function diffStreamingStates(
  prev: Readonly<Record<string, OnlineStatus>>,
  current: Readonly<Record<string, OnlineStatus>>,
): { accountId: string; status: OnlineStatus }[] {
  const changes: { accountId: string; status: OnlineStatus }[] = []
  for (const [accountId, status] of Object.entries(current)) {
    if (prev[accountId] !== status) changes.push({ accountId, status })
  }
  return changes
}

export function subscribeNoteDeckEvent(
  name: NoteDeckEventName,
  handler: EventHandler,
): Unsubscribe {
  switch (name) {
    case 'account:switch':
      return subscribeAccountSwitch(handler)
    case 'column:added':
      return subscribeColumnAdded(handler)
    case 'column:removed':
      return subscribeColumnRemoved(handler)
    case 'streaming:status':
      return subscribeStreamingStatus(handler)
    case 'note:new':
      return subscribeQueryDelta('note', handler)
    case 'notification:new':
      return subscribeQueryDelta('notification', handler)
    default: {
      const exhaustive: never = name
      throw new Error(`Unknown Nd:on event: ${String(exhaustive)}`)
    }
  }
}

// --- queryDelta fan-out (note:new / notification:new) ---

type QueryFlavor = 'note' | 'notification'

interface QueryInfo {
  flavor: QueryFlavor
  accountId: string
}

const queryInfoByQueryId = new Map<string, QueryInfo>()
const noteHandlers = new Set<EventHandler>()
const notificationHandlers = new Set<EventHandler>()
let queryDeltaUnlisten: (() => void) | null = null
let queryDeltaListenerPromise: Promise<void> | null = null

/**
 * useQuerySubscription が query を open したときに呼ぶ。queryDelta event を
 * note:new / notification:new に振り分けるための queryId -> {flavor, accountId}
 * マップを維持する。Rust 側 QueryKey の kind から flavor を導出し、chat 系は
 * 機密性 (DM) のため Phase 1 では除外する。
 */
export function registerQuery(queryId: string, key: QueryKey): void {
  const info = queryKeyToInfo(key)
  if (info) queryInfoByQueryId.set(queryId, info)
}

export function unregisterQuery(queryId: string): void {
  queryInfoByQueryId.delete(queryId)
}

function queryKeyToInfo(key: QueryKey): QueryInfo | null {
  switch (key.kind) {
    case 'timeline':
    case 'antenna':
    case 'channel':
    case 'role':
    case 'mentions':
      return { flavor: 'note', accountId: key.account_id }
    case 'notifications':
      return { flavor: 'notification', accountId: key.account_id }
    // chat 系 (chatUser / chatRoom) は DM 性質のため note:new から除外。
    // 必要なら 'chat:new' を別途設計する。
    default:
      return null
  }
}

function subscribeQueryDelta(
  flavor: QueryFlavor,
  handler: EventHandler,
): Unsubscribe {
  const target = flavor === 'note' ? noteHandlers : notificationHandlers
  target.add(handler)
  ensureQueryDeltaListener()
  return () => {
    target.delete(handler)
    if (noteHandlers.size === 0 && notificationHandlers.size === 0) {
      stopQueryDeltaListener()
    }
  }
}

function ensureQueryDeltaListener(): void {
  if (queryDeltaUnlisten || queryDeltaListenerPromise) return
  queryDeltaListenerPromise = events.queryDelta
    .listen((event) => {
      const delta = event.payload
      const info = queryInfoByQueryId.get(delta.queryId)
      if (!info) return
      if (delta.inserts.length === 0) return
      const target =
        info.flavor === 'note' ? noteHandlers : notificationHandlers
      if (target.size === 0) return
      const ids = extractInsertIds(delta.inserts)
      if (ids.length === 0) return
      const idKey = info.flavor === 'note' ? 'noteIds' : 'notificationIds'
      const payload: EventPayload = {
        queryId: delta.queryId,
        accountId: info.accountId,
        [idKey]: ids,
      }
      for (const h of target) h(payload)
    })
    .then((fn) => {
      queryDeltaUnlisten = fn
    })
    .catch((e) => {
      // 例: vitest など Tauri runtime のない環境。再試行は不要。
      console.warn('[Nd:on] queryDelta listen failed:', e)
    })
}

function stopQueryDeltaListener(): void {
  queryDeltaListenerPromise = null
  if (queryDeltaUnlisten) {
    queryDeltaUnlisten()
    queryDeltaUnlisten = null
  }
}

/**
 * queryDelta.inserts は JsonValue[] (note / notification 本体) だが、
 * payload に渡すのは `id` のみ。プラグインが本体を取得したければ
 * `Nd:call('notes.show', { id })` 経由で permissions に縛られる形にする
 * (機密ノートの payload 漏洩を防ぐ)。
 */
export function extractInsertIds(inserts: readonly JsonValue[]): string[] {
  const ids: string[] = []
  for (const item of inserts) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const id = (item as Record<string, unknown>).id
      if (typeof id === 'string') ids.push(id)
    }
  }
  return ids
}

/** @internal テスト用。テスト後にグローバル state をクリアする。 */
export function _resetEventStateForTest(): void {
  queryInfoByQueryId.clear()
  noteHandlers.clear()
  notificationHandlers.clear()
  stopQueryDeltaListener()
}

function subscribeAccountSwitch(handler: EventHandler): Unsubscribe {
  const store = useAccountsStore()
  return watch(
    () => store.activeAccountId,
    (newId, oldId) => {
      if (newId === oldId) return
      handler({ accountId: newId, previousAccountId: oldId ?? null })
    },
  )
}

function subscribeColumnAdded(handler: EventHandler): Unsubscribe {
  const store = useDeckStore()
  let prev = new Set(store.columns.map((c) => c.id))
  return watch(
    () => store.columns,
    (cols) => {
      const snap = cols.map(toColumnSnapshot)
      const { added, next } = diffColumns(prev, snap)
      for (const c of added) handler({ ...c })
      prev = next
    },
    { deep: true },
  )
}

function subscribeColumnRemoved(handler: EventHandler): Unsubscribe {
  const store = useDeckStore()
  let prev = new Set(store.columns.map((c) => c.id))
  return watch(
    () => store.columns,
    (cols) => {
      const snap = cols.map(toColumnSnapshot)
      const { removedIds, next } = diffColumns(prev, snap)
      for (const id of removedIds) handler({ id })
      prev = next
    },
    { deep: true },
  )
}

function subscribeStreamingStatus(handler: EventHandler): Unsubscribe {
  const store = useStreamingStore()
  let prev = { ...store.states }
  return watch(
    () => store.states,
    (states) => {
      const changes = diffStreamingStates(prev, states)
      for (const c of changes) handler(c)
      prev = { ...states }
    },
    { deep: true },
  )
}

function toColumnSnapshot(c: {
  id: string
  type: string
  name: string | null
  accountId: string | null
}): ColumnSnapshot {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    accountId: c.accountId,
  }
}

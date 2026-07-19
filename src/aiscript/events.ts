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
import type { QueryItem } from '@/bindings'
import { onQueryDelta } from '@/core/queryDeltaBus'
import {
  _resetQueryRegistryForTest,
  getQueryInfo,
  type QueryFlavor,
} from '@/core/queryRegistry'
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
  | 'memo:created'
  | 'memo:updated'
  | 'memo:deleted'
  | 'skill:edited'
  | 'theme:applied'

export const SUPPORTED_EVENT_NAMES: readonly NoteDeckEventName[] = [
  'account:switch',
  'column:added',
  'column:removed',
  'streaming:status',
  'note:new',
  'notification:new',
  'memo:created',
  'memo:updated',
  'memo:deleted',
  'skill:edited',
  'theme:applied',
]

// --- 汎用 pub/sub (store mutator → handler emit) ---
//
// memo:* / skill:edited / theme:applied のような「store mutator から発火する」
// イベントは store 状態を watch するより、mutator から直接 emit する方が
// シンプル + 高速。各 store の write 関数から `emitNoteDeckEvent(name, payload)`
// を呼ぶ。

const emitterHandlers = new Map<NoteDeckEventName, Set<EventHandler>>()

export function emitNoteDeckEvent(
  name: NoteDeckEventName,
  payload: EventPayload,
): void {
  const set = emitterHandlers.get(name)
  if (!set) return
  for (const handler of set) {
    try {
      handler(payload)
    } catch (e) {
      console.warn(`[Nd:on] handler for ${name} threw:`, e)
    }
  }
}

function subscribeEmitter(
  name: NoteDeckEventName,
  handler: EventHandler,
): Unsubscribe {
  let set = emitterHandlers.get(name)
  if (!set) {
    set = new Set()
    emitterHandlers.set(name, set)
  }
  set.add(handler)
  return () => {
    set?.delete(handler)
  }
}

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
    case 'memo:created':
    case 'memo:updated':
    case 'memo:deleted':
    case 'skill:edited':
    case 'theme:applied':
      return subscribeEmitter(name, handler)
    default: {
      const exhaustive: never = name
      throw new Error(`Unknown Nd:on event: ${String(exhaustive)}`)
    }
  }
}

// --- queryDelta fan-out (note:new / notification:new) ---
//
// queryId -> {flavor, accountId} の登録は実稼働の購読経路
// createQuerySubscription (adapters/misskey/query.ts) が core/queryRegistry
// 経由で行う (循環 import 回避のため core に分離)。

const noteHandlers = new Set<EventHandler>()
const notificationHandlers = new Set<EventHandler>()
let queryDeltaUnlisten: (() => void) | null = null

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
  if (queryDeltaUnlisten) return
  // queryDeltaBus 経由: Tauri への登録は bus の 1 本に集約され、
  // フォアグラウンド復帰時の再アタッチも bus 側で面倒を見る。
  queryDeltaUnlisten = onQueryDelta((delta) => {
    const info = getQueryInfo(delta.queryId)
    if (!info) return
    if (delta.inserts.length === 0) return
    const target = info.flavor === 'note' ? noteHandlers : notificationHandlers
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
}

function stopQueryDeltaListener(): void {
  if (queryDeltaUnlisten) {
    queryDeltaUnlisten()
    queryDeltaUnlisten = null
  }
}

/**
 * queryDelta.inserts は typed QueryItem[] (note / notification 本体) だが、
 * payload に渡すのは `id` のみ。プラグインが本体を取得したければ
 * `Nd:call('notes.show', { id })` 経由で permissions に縛られる形にする
 * (機密ノートの payload 漏洩を防ぐ)。
 */
export function extractInsertIds(inserts: readonly QueryItem[]): string[] {
  return inserts.map((item) => item.id)
}

/** @internal テスト用。テスト後にグローバル state をクリアする。 */
export function _resetEventStateForTest(): void {
  _resetQueryRegistryForTest()
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

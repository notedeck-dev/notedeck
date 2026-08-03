import type { QueryKey } from '@/bindings'

/**
 * queryId -> {flavor, accountId} レジストリ。
 *
 * AiScript プラグインの `Nd:on('note:new' / 'notification:new')` fan-out
 * (src/aiscript/events.ts) が queryDelta を振り分けるために参照する。
 * 登録は実稼働の購読経路 createQuerySubscription (adapters/misskey/query.ts)
 * が行う。aiscript/events.ts に置くと adapters → aiscript → stores →
 * adapters の循環 import になるため core に切り出している。
 */

export type QueryFlavor = 'note' | 'notification'

export interface QueryInfo {
  flavor: QueryFlavor
  accountId: string
}

// Rust QueryRuntime は同一 canonical key の query を dedup して subscriber_count
// で共有する。JS 側も同じ queryId を複数の購読 (例: per-account 通知カラムと
// cross-account 通知カラム) が register/unregister するため、refcount しないと
// 片方の dispose で生きている query のエントリが消え、プラグイン fan-out が
// 無音停止する。
interface RegistryEntry {
  info: QueryInfo
  refs: number
}

const entriesByQueryId = new Map<string, RegistryEntry>()

export function registerQuery(queryId: string, key: QueryKey): void {
  const existing = entriesByQueryId.get(queryId)
  if (existing) {
    existing.refs++
    return
  }
  const info = queryKeyToInfo(key)
  if (info) entriesByQueryId.set(queryId, { info, refs: 1 })
}

export function unregisterQuery(queryId: string): void {
  const entry = entriesByQueryId.get(queryId)
  if (!entry) return
  entry.refs--
  if (entry.refs <= 0) entriesByQueryId.delete(queryId)
}

export function getQueryInfo(queryId: string): QueryInfo | undefined {
  return entriesByQueryId.get(queryId)?.info
}

function queryKeyToInfo(key: QueryKey): QueryInfo | null {
  switch (key.kind) {
    // notes 系購読は 'timeline' に折り畳まれた (notecli#30 v5 §6-5)。
    // antenna/channel/role/mentions は key.key の canonical 文字列
    // (antenna:{id} 等) で区別される
    case 'timeline':
      return { flavor: 'note', accountId: key.account_id }
    case 'notifications':
      return { flavor: 'notification', accountId: key.account_id }
    // chat 系 (chatUser / chatRoom) は DM 性質のため note:new から除外。
    // 必要なら 'chat:new' を別途設計する。
    default:
      return null
  }
}

/** @internal テスト用。 */
export function _resetQueryRegistryForTest(): void {
  entriesByQueryId.clear()
}

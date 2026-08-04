/**
 * カラム定義から SQLite キャッシュの canonical timeline キーを導出する共有
 * ユーティリティ (notecli#30 v5 §6-12)。
 *
 * 各 Deck*Column の `cache.getKey()` と DeckColumnsArea の snapshot ミラーの
 * 両方がここを通ることで、キー手組みの表記ゆれ (list:{id} vs user-list:{id}
 * 等) を構造的に排除する。canonical 形式の正本は notecli `TimelineKey` の
 * doc comment。
 *
 * guest 判定 (hasToken 無しアカウント) は accountsStore.accountMap に依存して
 * おり column 単独では導出できないため、呼び出し側が `isGuestAccount` を注入
 * する。
 */
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'

export interface ColumnCacheKeyDeps {
  /** accountId が guest (hasToken 無し) なら true */
  isGuestAccount: (accountId: string) => boolean
}

/**
 * accountsStore ベースの既定 deps。pinia が有効な文脈 (setup / ハンドラ) で
 * 呼ぶこと。テストでは deps を直接組んで純粋関数として検証する。
 */
export function accountsCacheKeyDeps(): ColumnCacheKeyDeps {
  const accountsStore = useAccountsStore()
  return {
    isGuestAccount: (accountId) =>
      accountsStore.accountMap.get(accountId)?.hasToken === false,
  }
}

/** favorites カラム・invalidateColumnByKey の共有 canonical キー */
export const FAVORITES_CACHE_KEY = 'favorites'

export const antennaCacheKey = (antennaId: string): string =>
  `antenna:${antennaId}`
export const channelCacheKey = (channelId: string): string =>
  `channel:${channelId}`
export const clipCacheKey = (clipId: string): string => `clip:${clipId}`
export const roleCacheKey = (roleId: string): string => `role:${roleId}`
export const userNotesCacheKey = (userId: string): string => `user:${userId}`
export const userListCacheKey = (listId: string): string =>
  `user-list:${listId}`

/**
 * カラムの canonical キャッシュキー。キャッシュを持たない種別・必須 id 欠落は
 * null (= キャッシュ読み書きしない)。
 *
 * timeline 種別は `col.tl ?? default` (default: 'home'、guest は 'local')。
 * guest は home/social に到達できないため 'local' へ強制変換する —
 * DeckTimelineColumn の setup 時変換 (§6-13 で永続化) と同一規則。
 */
export function columnCacheKey(
  column: DeckColumn,
  deps: ColumnCacheKeyDeps,
): string | null {
  switch (column.type) {
    case 'timeline': {
      const isGuest = column.accountId
        ? deps.isGuestAccount(column.accountId)
        : false
      const tl = column.tl ?? (isGuest ? 'local' : 'home')
      return isGuest && (tl === 'home' || tl === 'social') ? 'local' : tl
    }
    case 'antenna':
      return column.antennaId ? antennaCacheKey(column.antennaId) : null
    case 'channel':
      return column.channelId ? channelCacheKey(column.channelId) : null
    case 'clip':
      return column.clipId ? clipCacheKey(column.clipId) : null
    case 'user':
      return column.userId ? userNotesCacheKey(column.userId) : null
    case 'list':
      return column.listId ? userListCacheKey(column.listId) : null
    case 'role':
      return column.roleId ? roleCacheKey(column.roleId) : null
    case 'favorites':
      return FAVORITES_CACHE_KEY
    case 'explore':
      // 読み出し専用キー。書込経路はなく常に空読み (notecli TimelineKey doc 参照)
      return 'explore'
    case 'mentions':
      return 'mentions'
    case 'specified':
      return 'specified'
    default:
      return null
  }
}

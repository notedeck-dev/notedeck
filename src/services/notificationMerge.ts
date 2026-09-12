import type { NormalizedNotification } from '@/adapters/types'
import { variantKey } from '@/services/noteKey'

/**
 * 通知リストのマージ規則 (取得元アカウント + ID で一意、createdAt 降順、limit で切り詰め)。
 *
 * 通知 ID はサーバー内でしか一意でない。cross-account では別サーバーの通知が
 * 同じ ID を持ち得るので、ID 単独をキーにすると片方が黙って消える (#1010)。
 *
 * REST 取得分とキャッシュのマージだけでなく、ライブ到着分の描画バッファ
 * 反映もこの規則を通す。復帰時は resumeBackfill の REST 補完とストリーム
 * 再配信が同じ通知を運んでくるため、経路ごとに独自の結合をすると重複表示
 * になる (#1006)。
 */
export function mergeNotifications(
  fresh: NormalizedNotification[],
  cached: NormalizedNotification[],
  limit: number,
): NormalizedNotification[] {
  const map = new Map<string, NormalizedNotification>()
  for (const n of cached) map.set(variantKey(n._accountId, n.id), n)
  for (const n of fresh) map.set(variantKey(n._accountId, n.id), n) // fresh overwrites cached
  // ISO 8601 strings are lexicographically sortable — avoid Date object allocation
  return [...map.values()]
    .sort((a, b) =>
      b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0,
    )
    .slice(0, limit)
}

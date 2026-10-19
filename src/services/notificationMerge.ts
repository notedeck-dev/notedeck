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
export interface MergeNotificationsOptions {
  /**
   * 上限超過時にどちら側を捨てるか。既定の 'oldest' は末尾 (古い側) で、上から
   * 新着が流れ込む経路に合う。下方向のページングは逆で、足したばかりの古い通知が
   * 即座に捨てられて画面が変わらなくなるため 'newest' を使う (#834 と同じ理由)
   */
  trim?: 'oldest' | 'newest'
  /**
   * 表示の下限 (全アカウント面の水平線、#1184)。これより古い通知は上限に数えず、
   * 落とさない (表示側で隠す。落とすと到達点が列から消えて水平線が跳ねる)
   */
  floor?: string | null
}

export function mergeNotifications(
  fresh: NormalizedNotification[],
  cached: NormalizedNotification[],
  limit: number,
  options: MergeNotificationsOptions = {},
): NormalizedNotification[] {
  const map = new Map<string, NormalizedNotification>()
  for (const n of cached) map.set(variantKey(n._accountId, n.id), n)
  for (const n of fresh) map.set(variantKey(n._accountId, n.id), n) // fresh overwrites cached
  // ISO 8601 strings are lexicographically sortable — avoid Date object allocation
  const sorted = [...map.values()].sort((a, b) =>
    b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0,
  )
  const floor = options.floor ?? null
  const counts = (n: NormalizedNotification) =>
    floor === null || n.createdAt >= floor
  let visible = 0
  for (const n of sorted) if (counts(n)) visible++
  if (visible <= limit) return sorted
  let drop = visible - limit
  if (options.trim === 'newest') {
    const out: NormalizedNotification[] = []
    for (const n of sorted) {
      if (drop > 0 && counts(n)) {
        drop--
        continue
      }
      out.push(n)
    }
    return out
  }
  const out: NormalizedNotification[] = []
  let kept = 0
  for (const n of sorted) {
    if (counts(n)) {
      if (kept >= limit) continue
      kept++
    }
    out.push(n)
  }
  return out
}

import { normalizeEmojiMuteKey } from '@/utils/emojiMute'

/**
 * ミュート・凍結ユーザーのリアクション抹消 (#575) の数え直し。
 *
 * サーバーの `notes/reactions` 列挙はミュート/ブロックユーザーを除外して
 * 返す (本家仕様) 一方、`note.reactions` の集計には含まれる。この非対称を
 * 利用し、列挙を数え直した値を表示カウントにすることで「そもそも
 * リアクションしていないかのように見える」状態を作る。
 *
 * さらに `isHiddenUser` でクライアント側の照合を重ねる:
 * - 凍結ユーザー (#828 検知) はサーバーが除外しないためここで差し引く
 * - ミュート直後は古い列挙にそのユーザーが残っているため、サーバーの
 *   除外を待たずに即時反映できる (二重照合は無害)
 */

export interface VisibleReactionRecord {
  /** リアクション種別 (`:name@host:` / Unicode) */
  type: string
  /** リアクションしたユーザー ID */
  userId: string
}

/** 列挙から serverCounts のキー体系でカウントを再構成する。0 件になった絵文字はキーごと消える。 */
export function recountVisibleReactions(
  serverCounts: Record<string, number>,
  visibleRecords: VisibleReactionRecord[],
  isHiddenUser?: (userId: string) => boolean,
): Record<string, number> {
  const counted = new Map<string, number>()
  for (const r of visibleRecords) {
    if (isHiddenUser?.(r.userId)) continue
    const key = normalizeEmojiMuteKey(r.type)
    counted.set(key, (counted.get(key) ?? 0) + 1)
  }
  const out: Record<string, number> = {}
  for (const key of Object.keys(serverCounts)) {
    const n = counted.get(normalizeEmojiMuteKey(key)) ?? 0
    if (n > 0) out[key] = n
  }
  return out
}

/** リアクション総数 (取得コスト上限の判定に使う) */
export function totalReactionCount(counts: Record<string, number>): number {
  let sum = 0
  for (const n of Object.values(counts)) sum += n
  return sum
}

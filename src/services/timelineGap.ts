import type { NormalizedNote } from '@/adapters/types'
import { type VariantKey, variantKeyOf } from '@/services/noteKey'

/**
 * 最新ページと表示中ノートの重なりで 1 ページ超の欠落を判定する (#791)。
 *
 * 重なりゼロ = 最新ページの最古ですら表示中の先頭より新しい。マージすると
 * 間に隠れた穴が残るため、呼び出し側は最新ページで丸ごと置換する (古いノートは
 * スクロールで再取得可能)。復帰 (onResume)・タブ切替・手動リロード共通の
 * catch-up 判定。
 *
 * 全アカウント面ではアカウントごとに評価する (#1058 §6): 1 アカウントの gap で
 * 他アカウントの行を消さないため、`shown` にはそのアカウントの行キーだけを渡す。
 */
export function hasGap(
  fetched: readonly NormalizedNote[],
  shown: ReadonlySet<VariantKey>,
  hadNotes: boolean,
): boolean {
  return (
    hadNotes &&
    fetched.length > 0 &&
    !fetched.some((n) => shown.has(variantKeyOf(n)))
  )
}

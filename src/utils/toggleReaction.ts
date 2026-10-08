import type { NormalizedNote } from '@/adapters/types'
import { type VariantKey, variantKeyOf } from '@/services/noteKey'
import {
  type ReactionApi,
  type ReactionPatchFn,
  toggleReactionOptimistic,
} from '@/services/reactionToggle'
import { hapticLight } from '@/utils/haptics'

/**
 * 進行中の variant。adapter 取得が非同期な面 (束ねる面・照会) では連打が同じ
 * `note.myReaction` から差分を計算して二重 create になるため、variant key
 * 単位でここ 1 か所で塞ぐ (#1058 §5.6)。
 */
const inFlight = new Set<VariantKey>()

/**
 * リアクションのトグル。差分計算とロールバックは services/reactionToggle、
 * ここは連打の抑止と触覚 (Tauri) だけ。
 */
export async function toggleReaction(
  api: ReactionApi,
  note: NormalizedNote,
  reaction: string,
  apply: (compute: ReactionPatchFn) => void,
): Promise<void> {
  const key = variantKeyOf(note)
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    hapticLight()
    await toggleReactionOptimistic(api, note, reaction, apply)
  } finally {
    inFlight.delete(key)
  }
}

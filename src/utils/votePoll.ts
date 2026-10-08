import type { NormalizedNote } from '@/adapters/types'
import {
  canVotePoll,
  type PollApi,
  type PollPatchFn,
  votePollOptimistic,
} from '@/services/pollVote'
import { hapticLight } from '@/utils/haptics'

/**
 * 投票。判定と差分適用は services/pollVote、ここは触覚 (Tauri) だけ。
 * 投票できないときは触覚も鳴らさない (従来どおり)。
 */
export async function votePoll(
  api: PollApi,
  note: NormalizedNote,
  choice: number,
  apply: (compute: PollPatchFn) => void,
): Promise<void> {
  if (!canVotePoll(note, choice)) return
  hapticLight()
  await votePollOptimistic(api, note, choice, apply)
}

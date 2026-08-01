import type { NormalizedNote, NormalizedPoll } from '@/adapters/types'
import { hapticLight } from '@/utils/haptics'

interface PollApi {
  votePoll(noteId: string, choice: number): Promise<void>
}

/** 楽観的更新の差分。apply コールバックが表示側の保持形態に応じて反映する */
export interface PollPatch {
  poll: NormalizedPoll
}

/**
 * 差分を「呼び出し元が持つ最新のノート」から計算する関数 (#904)。
 * 呼び出し元は自分の保持形態から現在のノートを取り出して渡し、返った差分を
 * そこへマージする。
 */
export type PollPatchFn = (current: NormalizedNote) => PollPatch

function withVoted(
  poll: NormalizedPoll,
  choice: number,
  isVoted: boolean,
): NormalizedPoll {
  return {
    ...poll,
    choices: poll.choices.map((c, i) => (i === choice ? { ...c, isVoted } : c)),
  }
}

/**
 * 投票を楽観的更新つきで行う (toggleReaction と同じ差分適用方式 #888)。
 *
 * note は読み取り専用 — mutate せず、差分を `apply` に渡す。呼び出し元は
 * 自分の保持形態 (noteStore / deep ref / shallowRef の配列) に応じて
 * 「新しいオブジェクトへの差し替え」として反映する。
 *
 * isVoted のみ楽観更新し、votes の +1 はストリーミングの pollVoted
 * イベントに任せる (二重カウントを避けるため)。未接続時は次回取得で整合する。
 *
 * 失敗時は「押した選択肢の isVoted」だけを最新状態の上で戻す。開始時の poll で
 * 丸ごと置き換えると、API を待つ間に届いた他人の票まで巻き戻る (#904)。
 */
export async function votePoll(
  api: PollApi,
  note: NormalizedNote,
  choice: number,
  apply: (compute: PollPatchFn) => void,
): Promise<void> {
  const poll = note.poll
  if (!poll) return
  if (poll.expiresAt && new Date(poll.expiresAt) < new Date()) return
  const target = poll.choices[choice]
  if (!target) return
  if (target.isVoted) return
  if (!poll.multiple && poll.choices.some((c) => c.isVoted)) return

  hapticLight()
  apply((cur) => ({ poll: withVoted(cur.poll ?? poll, choice, true) }))

  try {
    await api.votePoll(note.id, choice)
  } catch (e) {
    apply((cur) => ({ poll: withVoted(cur.poll ?? poll, choice, false) }))
    throw e
  }
}

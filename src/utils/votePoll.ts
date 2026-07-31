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
 * 投票を楽観的更新つきで行う (toggleReaction と同じ差分適用方式 #888)。
 *
 * note は読み取り専用 — mutate せず、差分を `apply` に渡す。呼び出し元は
 * 自分の保持形態 (noteStore / deep ref / shallowRef の配列) に応じて
 * 「新しいオブジェクトへの差し替え」として反映する。
 *
 * isVoted のみ楽観更新し、votes の +1 はストリーミングの pollVoted
 * イベントに任せる (二重カウントを避けるため)。未接続時は次回取得で整合する。
 *
 * 失敗時は元の状態を apply し直してから throw する。
 */
export async function votePoll(
  api: PollApi,
  note: NormalizedNote,
  choice: number,
  apply: (patch: PollPatch) => void,
): Promise<void> {
  const poll = note.poll
  if (!poll) return
  if (poll.expiresAt && new Date(poll.expiresAt) < new Date()) return
  const target = poll.choices[choice]
  if (!target) return
  if (target.isVoted) return
  if (!poll.multiple && poll.choices.some((c) => c.isVoted)) return

  hapticLight()
  // note を mutate していないので、ロールバックは元の poll をそのまま返せる
  const prevPatch: PollPatch = { poll }

  apply({
    poll: {
      ...poll,
      choices: poll.choices.map((c, i) =>
        i === choice ? { ...c, isVoted: true } : c,
      ),
    },
  })

  try {
    await api.votePoll(note.id, choice)
  } catch (e) {
    apply(prevPatch)
    throw e
  }
}

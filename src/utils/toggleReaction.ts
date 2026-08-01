import type { NormalizedNote } from '@/adapters/types'
import { hapticLight } from '@/utils/haptics'

interface ReactionApi {
  createReaction(noteId: string, reaction: string): Promise<void>
  deleteReaction(noteId: string): Promise<void>
}

/** 楽観的更新の差分。apply コールバックが表示側の保持形態に応じて反映する */
export interface ReactionPatch {
  reactions: Record<string, number>
  myReaction: string | null
}

/**
 * 差分を「呼び出し元が持つ最新のノート」から計算する関数 (#904)。
 * 呼び出し元は自分の保持形態から現在のノートを取り出して渡し、返った差分を
 * そこへマージする。await をまたいで届いたストリーミング更新を巻き込まない。
 */
export type ReactionPatchFn = (current: NormalizedNote) => ReactionPatch

/** reactions に増減を適用した新オブジェクト (0 以下でキーごと削除) */
function withDelta(
  reactions: Record<string, number>,
  delta: Record<string, number>,
): Record<string, number> {
  const next = { ...reactions }
  for (const [key, d] of Object.entries(delta)) {
    const count = (next[key] ?? 0) + d
    if (count > 0) next[key] = count
    else delete next[key]
  }
  return next
}

function negated(delta: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(delta).map(([k, d]) => [k, -d]))
}

/**
 * リアクションのトグル (追加 / 取消 / 切替) を楽観的更新つきで行う。
 *
 * note は読み取り専用 — mutate せず、差分を `apply` に渡す。呼び出し元は
 * 自分の保持形態 (noteStore / deep ref / shallowRef の配列) に応じて
 * 「新しいオブジェクトへの差し替え」として反映する。以前は note を直接
 * mutate していたため、shallowRef で保持する面 (プロフィール・通知カラム
 * 等) では Vue が変更を検知できず、押しても表示が変わらなかった。
 * `patch.reactions` は常に新オブジェクトなので、reactions の参照を watch
 * する購読 (#575 の数え直し等) も確実に発火する。
 *
 * 適用もロールバックも「自分が動かした絵文字の増減」だけを最新状態へ足し引き
 * する。開始時のスナップショットで丸ごと置き換えると、API を待つ間に届いた
 * 他人のリアクションまで巻き戻してしまう (#904)。
 */
export async function toggleReaction(
  api: ReactionApi,
  note: NormalizedNote,
  reaction: string,
  apply: (compute: ReactionPatchFn) => void,
): Promise<void> {
  hapticLight()
  const prevReaction = note.myReaction ?? null
  /** 楽観的更新で加えた増減。ロールバックはこれを最新状態から引く */
  const delta: Record<string, number> = {}

  // 切替 (取消 → 付与) の途中経過。取消だけ成功して付与に失敗した場合、
  // サーバーは「リアクション無し」なので、元へ巻き戻すと旧絵文字のカウントが
  // 1 多いまま次の取得まで残る (#891)
  let removedOnServer = false

  try {
    if (prevReaction === reaction) {
      // 取消
      delta[reaction] = -1
      apply((cur) => ({
        reactions: withDelta(cur.reactions, delta),
        myReaction: null,
      }))
      await api.deleteReaction(note.id)
    } else {
      // 追加 / 切替
      if (prevReaction) delta[prevReaction] = -1
      delta[reaction] = (delta[reaction] ?? 0) + 1
      apply((cur) => ({
        reactions: withDelta(cur.reactions, delta),
        myReaction: reaction,
      }))

      if (prevReaction) {
        await api.deleteReaction(note.id)
        removedOnServer = true
      }
      await api.createReaction(note.id, reaction)
    }
  } catch (e) {
    // 取消だけ成立しているなら、旧絵文字の減算は戻さず付与分だけ取り消す
    const undo = removedOnServer ? { [reaction]: -1 } : negated(delta)
    apply((cur) => ({
      reactions: withDelta(cur.reactions, undo),
      myReaction: removedOnServer ? null : prevReaction,
    }))
    throw e
  }
}

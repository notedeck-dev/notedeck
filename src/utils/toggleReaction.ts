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

/** reactions から 1 減算した新オブジェクト (0 でキーごと削除) */
function decremented(
  reactions: Record<string, number>,
  key: string,
): Record<string, number> {
  const next = { ...reactions }
  if ((next[key] ?? 0) > 1) next[key] = (next[key] ?? 0) - 1
  else delete next[key]
  return next
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
 * 失敗時は元の状態を apply し直してから throw する。
 */
export async function toggleReaction(
  api: ReactionApi,
  note: NormalizedNote,
  reaction: string,
  apply: (patch: ReactionPatch) => void,
): Promise<void> {
  hapticLight()
  const prevReaction = note.myReaction
  const prevPatch: ReactionPatch = {
    reactions: { ...note.reactions },
    myReaction: prevReaction ?? null,
  }

  try {
    if (prevReaction === reaction) {
      // 取消
      apply({
        reactions: decremented(note.reactions, reaction),
        myReaction: null,
      })
      await api.deleteReaction(note.id)
    } else {
      // 追加 / 切替
      const next = prevReaction
        ? decremented(note.reactions, prevReaction)
        : { ...note.reactions }
      next[reaction] = (next[reaction] ?? 0) + 1
      apply({ reactions: next, myReaction: reaction })

      if (prevReaction) {
        await api.deleteReaction(note.id)
      }
      await api.createReaction(note.id, reaction)
    }
  } catch (e) {
    // Rollback to previous state on failure
    apply(prevPatch)
    throw e
  }
}

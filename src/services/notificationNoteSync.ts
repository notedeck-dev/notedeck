/**
 * 通知カラムが独自保持する `notification.note` を noteStore の最新へ揃える規則。
 *
 * 通知カラムは note を noteStore 経由ではなく自分の配列に持つため、
 * 楽観的更新 (toggleReaction) やストリーム適用が store に入っても表示へ
 * 届かない。mutation のたびにここを通して最新オブジェクトへ差し替える。
 *
 * pure renote (リノート通知等) では MkNote が内側のノートを emit するので
 * store は内側の id で更新される。外側の id しか照会しないと、リノート通知
 * でリアクションを押しても表示が更新されない。`handlePosted` の編集反映と
 * 同じく renoteId でも引き当てる。
 */

import type { NormalizedNote, NormalizedNotification } from '@/adapters/types'

export function syncNotificationNotes(
  notifications: NormalizedNotification[],
  getNote: (id: string) => NormalizedNote | undefined,
): NormalizedNotification[] {
  return notifications.map((n) => {
    if (!n.note) return n
    const latest = getNote(n.note.id)
    if (latest && latest !== n.note) return { ...n, note: latest }
    if (n.note.renoteId) {
      const latestRenote = getNote(n.note.renoteId)
      if (latestRenote && latestRenote !== n.note.renote) {
        return { ...n, note: { ...n.note, renote: latestRenote } }
      }
    }
    return n
  })
}

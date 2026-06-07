import type { NormalizedNote } from '@/adapters/types'
import { useMuteStore } from '@/stores/mutes'
import { useNoteStore } from '@/stores/notes'

/**
 * ノートの表示可視性述語。
 *
 * 「データは保持し、表示時に boolean 述語で隠す/戻す」という方針の単一入口
 * （#602 で導入）。取り込み時フィルタや物理削除と違いデータを破棄しないため、
 * 即時・遡及・解除復活が可能で、#574（ミュート遡及非表示）/ 魚拓（削除ノート
 * 保持）の土台を兼ねる。
 *
 * 述語の合成は storage 層（noteStore）でなくこの consumption 層に集約する。
 * mute/archive は account 層の関心事で、noteStore に OR 合成させると
 * 上方向依存（layering smell）になるため。
 */
export function useNoteVisibility() {
  const noteStore = useNoteStore()
  const muteStore = useMuteStore()

  /**
   * 表示から隠すべきノートか。判定材料:
   * - 削除 tombstone（#602, 非 reactive・再読込復活を抑止）
   * - ミュート（#574, per-account reactive・投稿者/reply先/renote元のいずれか）
   * ミュートは reactive なので、この述語を読む computed は解除で即復活する。
   */
  function isHidden(note: NormalizedNote): boolean {
    if (noteStore.isDeleted(note.id)) return true
    const acc = note._accountId
    return (
      muteStore.isMuted(acc, note.user.id) ||
      muteStore.isMuted(acc, note.reply?.user?.id) ||
      muteStore.isMuted(acc, note.renote?.user?.id)
    )
    // 将来の OR 合成点: || archiveStore.isArchived(...)  // 魚拓
  }

  return { isHidden }
}

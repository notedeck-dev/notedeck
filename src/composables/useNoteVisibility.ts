import type { NormalizedNote } from '@/adapters/types'
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

  /** 表示から隠すべきノートか。現在の判定材料は削除 tombstone のみ（#602）。 */
  function isHidden(note: NormalizedNote): boolean {
    return noteStore.isDeleted(note.id)
    // 将来の OR 合成点:
    //   || muteStore.isMuted(note.user.id)        // #574
    //   || archiveStore.isArchived(note.user.id)  // 魚拓
  }

  return { isHidden }
}

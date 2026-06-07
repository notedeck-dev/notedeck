import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'

/**
 * ミュート中ユーザーの per-account reactive 状態（#574）。
 *
 * 表示述語 useNoteVisibility().isHidden の判定材料その2。reactive なので、
 * ミュート操作で mutedByAccount が変わると全カラムの notes computed が再評価され、
 * 既に並んでいる過去ノートもリロード無しで即時非表示になる（解除で復活）。
 * 削除 tombstone（noteStore.deletedIds, plain Set）と違い reactive 必須なのは、
 * orderedIds の再代入を伴わず表示を更新する必要があるため。
 *
 * mutedByAccount: accountId → muted userId の Set。ミュートは per-account のため
 * note._accountId をキーに判定する。
 */
export const useMuteStore = defineStore('mutes', () => {
  const mutedByAccount = shallowRef(new Map<string, Set<string>>())

  function isMuted(
    accountId: string,
    userId: string | null | undefined,
  ): boolean {
    if (!userId) return false
    return mutedByAccount.value.get(accountId)?.has(userId) ?? false
  }

  function mute(accountId: string, userId: string) {
    let set = mutedByAccount.value.get(accountId)
    if (!set) {
      set = new Set()
      mutedByAccount.value.set(accountId, set)
    }
    set.add(userId)
    triggerRef(mutedByAccount)
  }

  function unmute(accountId: string, userId: string) {
    mutedByAccount.value.get(accountId)?.delete(userId)
    triggerRef(mutedByAccount)
  }

  /** mute/list 同期。アカウントのミュート集合を丸ごと置き換える。 */
  function setMuted(accountId: string, userIds: string[]) {
    mutedByAccount.value.set(accountId, new Set(userIds))
    triggerRef(mutedByAccount)
  }

  return { isMuted, mute, unmute, setMuted }
})

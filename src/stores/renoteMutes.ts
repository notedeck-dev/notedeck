import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'

/**
 * リノートミュート中ユーザーの per-account reactive 状態（#614）。
 *
 * [[useMuteStore]] と同型。`useNoteVisibility().isHidden` が「純粋リノート
 * （renote && text===null）のリノート主」がここに含まれるかを見て隠す。
 * reactive なので renote mute / 解除で即時に表示反映（リロード不要）。
 * 起動時は `renote-mute/list` から setMuted で hydrate（#614）。
 */
export const useRenoteMuteStore = defineStore('renoteMutes', () => {
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

  /** renote-mute/list 同期。アカウントの集合を丸ごと置き換える。 */
  function setMuted(accountId: string, userIds: string[]) {
    mutedByAccount.value.set(accountId, new Set(userIds))
    triggerRef(mutedByAccount)
  }

  return { isMuted, mute, unmute, setMuted }
})

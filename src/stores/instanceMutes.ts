import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'

/**
 * インスタンス（サーバー）ミュートの per-account reactive 状態（#613）。
 *
 * [[useMuteStore]] と同型だが、ユーザー ID ではなくホスト名（`user.host`）の集合。
 * `useNoteVisibility().isHidden` が note / reply / renote の投稿者 host が
 * ここに含まれるかを見て隠す。サーバ（Misskey `i` の mutedInstances）から
 * read のみで取得し setMuted で hydrate する（NoteDeck からは編集しない）。
 */
export const useInstanceMuteStore = defineStore('instanceMutes', () => {
  const mutedByAccount = shallowRef(new Map<string, Set<string>>())

  function isMuted(
    accountId: string,
    host: string | null | undefined,
  ): boolean {
    if (!host) return false
    return mutedByAccount.value.get(accountId)?.has(host) ?? false
  }

  /** mutedInstances 同期。アカウントのホスト集合を丸ごと置き換える。 */
  function setMuted(accountId: string, hosts: string[]) {
    mutedByAccount.value.set(accountId, new Set(hosts))
    triggerRef(mutedByAccount)
  }

  return { isMuted, setMuted }
})

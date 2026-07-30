import { computed, type Ref, watch } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import { useMutesStore } from '@/stores/mutes'
import { useReactionRecountsStore } from '@/stores/reactionRecounts'
import { useSettingsStore } from '@/stores/settings'

/**
 * ミュート・凍結ユーザーのリアクションを抹消した表示用カウント (#575)。
 * リアクションバーを持つ面 (MkNote / ノート詳細) から使う。
 * `counts` が null の間はサーバー集計のまま表示する。
 *
 * トグル (`mute.hideMutedUserReactions`) 自体がオプトインなので、ON なら
 * ミュート/凍結の有無を問わず列挙を取得する — 凍結はサーバー側の除外に
 * 頼れず、取得しないと差分が判定できないため。
 */
export function useVisibleReactionCounts(
  note: () => Pick<NormalizedNote, 'id' | 'reactions' | '_accountId'> | null,
  visible?: Ref<boolean>,
) {
  const settingsStore = useSettingsStore()
  const recountsStore = useReactionRecountsStore()
  const mutesStore = useMutesStore()

  const enabled = computed(
    () => settingsStore.get('mute.hideMutedUserReactions') === true,
  )

  const counts = computed(() => {
    const n = note()
    if (!enabled.value || !n) return null
    return recountsStore.get(n._accountId, n.id, n.reactions)
  })

  watch(
    [
      enabled,
      () => visible?.value ?? true,
      () => note()?.id,
      () => note()?.reactions,
      // ミュート解除 (縮小方向) は purge されるので取り直しを駆動する
      () => mutesStore.mutedUsersRemovalVersion,
    ],
    () => {
      const n = note()
      if (!n || !enabled.value || !(visible?.value ?? true)) return
      recountsStore.ensure(n._accountId, n.id, n.reactions)
    },
    { immediate: true },
  )

  return { enabled, counts }
}

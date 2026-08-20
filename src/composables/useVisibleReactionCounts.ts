import { computed, type Ref, watch } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import { useMutesStore } from '@/stores/mutes'
import { useReactionRecountsStore } from '@/stores/reactionRecounts'
import { useSettingsStore } from '@/stores/settings'

/**
 * ミュート・凍結ユーザーのリアクションを抹消した表示用カウント (#575)。
 * リアクションバーを持つ面 (MkNote / ノート詳細) から使う。
 * `pending` の間は描画を保留し、それ以外で `counts` が null なら
 * サーバー集計のまま表示する (対象外・取得失敗のフォールバック)。
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

  // 列挙の初回取得待ち (#1081)。true の間は未フィルタのサーバー集計を
  // 描画せず保留する — キャッシュ表示で「見えてから消える」のを防ぐ
  const pending = computed(() => {
    const n = note()
    if (!enabled.value || !n) return false
    return recountsStore.isPending(n.id, n.reactions)
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

  return { enabled, counts, pending }
}

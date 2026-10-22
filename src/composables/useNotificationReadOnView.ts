import { computed, onScopeDispose, ref, watch } from 'vue'
import { useColumnLive } from '@/composables/useColumnMount'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { commands } from '@/utils/tauriInvoke'

/**
 * 通知の既読は「見たとき」だけにする (#330 §3.2)。
 *
 * 可視 = カラムが viewport 内 (useColumnLive) かつウィンドウにフォーカスがあり
 * ページが隠れていない。mount しているだけ (Android の背面、デスクトップの画面外) は
 * 可視ではない。
 *
 * - 可視になったとき: 口座ごとに `markAsRead: true` の取得で既読にする (権限不要)
 * - 可視のまま新着が届いたとき: WS の `readNotification` で既読にする (本家 Web と同じ、
 *   権限不要)。ポーリング中は WS が無いので、可視になったときと同じ取得で既読にする
 *
 * 通知の取得そのものは既読にしないので、復帰時の補填やポーリングで「見ていないのに
 * 既読」にならない。
 */
export function useNotificationReadOnView(
  columnId: string,
  getAccountIds: () => string[],
) {
  const { isVisible } = useColumnLive(columnId)
  const focused = ref(document.hasFocus())
  const pageVisible = ref(document.visibilityState === 'visible')

  function onFocus() {
    focused.value = true
  }
  function onBlur() {
    focused.value = false
  }
  function onVisibilityChange() {
    pageVisible.value = document.visibilityState === 'visible'
  }
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)
  onScopeDispose(() => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  const viewed = computed(
    () => isVisible.value && focused.value && pageVisible.value,
  )

  function readOnView() {
    for (const accountId of getAccountIds()) {
      commands.apiReadNotificationsOnView(accountId).catch(() => {
        // 既読は best effort。失敗しても表示には影響しない
      })
    }
  }

  watch(viewed, (v) => v && readOnView(), { immediate: true })
  // 可視のまま口座が増えたら (全アカウント面に追加された等) その分も既読にする
  watch(
    () => getAccountIds().join('\n'),
    () => viewed.value && readOnView(),
  )

  /** 新着が届いたときに呼ぶ。見ている最中なら既読にする */
  function onArrival(accountId: string) {
    if (!viewed.value) return
    const read = useRealtimeModeStore().isRealtime
      ? commands.streamReadNotifications(accountId)
      : commands.apiReadNotificationsOnView(accountId)
    read.catch(() => {
      // 同上
    })
  }

  return { viewed, onArrival }
}

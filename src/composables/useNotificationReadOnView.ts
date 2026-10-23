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
/**
 * 見えている通知カラムの口座 (カラム横断の和集合)。Rust はここに含まれる口座の
 * 通知を OS 通知にしない (#330 §3.3: 見ている最中はアプリ内の表示で足りる)。
 * デスクトップも Android も同じ規則。Android は Activity の前面フラグと組で判定する
 */
const visibleByColumn = new Map<string, string[]>()

function reportVisibleScopes() {
  const union = new Set<string>()
  for (const ids of visibleByColumn.values())
    for (const id of ids) union.add(id)
  commands.setVisibleNotificationScopes([...union]).catch(() => {
    // 抑止が効かないだけで表示には影響しない
  })
}

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

  function publishVisible() {
    if (viewed.value) visibleByColumn.set(columnId, getAccountIds())
    else visibleByColumn.delete(columnId)
    reportVisibleScopes()
  }

  watch(
    viewed,
    (v) => {
      if (v) readOnView()
      publishVisible()
    },
    { immediate: true },
  )
  // 可視のまま口座が増えたら (全アカウント面に追加された等) その分も既読にする
  watch(
    () => getAccountIds().join('\n'),
    () => {
      if (viewed.value) readOnView()
      publishVisible()
    },
  )
  onScopeDispose(() => {
    visibleByColumn.delete(columnId)
    reportVisibleScopes()
  })

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

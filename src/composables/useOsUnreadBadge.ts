import { getCurrentWindow } from '@tauri-apps/api/window'
import { computed, watch } from 'vue'
import { useUnreadChat } from '@/composables/useUnreadChat'
import { useUnreadNotifications } from '@/composables/useUnreadNotifications'
import { catchIgnore } from '@/utils/logger'
import { commands } from '@/utils/tauriInvoke'

/**
 * 通知 + チャットの未読合計を OS バッジへ反映する (#748)。
 * 実表示は Rust 側 set_unread_badge が担当:
 * Dock/ランチャーのバッジ件数、Windows タスクバーのオーバーレイ、
 * トレイの tooltip とアイコンの未読ドット。
 * hide-to-tray 設計のため、メインウィンドウで 1 mount する。
 */
export function useOsUnreadBadge() {
  // バッジと通知トレイは OS 全体で 1 つなので main ウィンドウだけが更新する
  if (getCurrentWindow().label !== 'main') return

  const { totalUnread: notificationUnread } = useUnreadNotifications()
  const { totalUnread: chatUnread } = useUnreadChat()

  const total = computed(() => notificationUnread.value + chatUnread.value)

  watch(
    total,
    (count) => {
      commands.setUnreadBadge(count).catch(catchIgnore('os-unread-badge'))
    },
    { immediate: true },
  )
}

import { ref } from 'vue'
import { commands } from '@/utils/tauriInvoke'

/**
 * OS 側の通知の許可状態 (Android)。アカウントメニューの状態行が、拒否が重なって
 * ダイアログが出なくなった後の導線 (OS の設定を開く) を出すのに使う (#330 §4.5)。
 * 判定できない OS では null のまま。
 */
export function useNotificationPermissionState() {
  const granted = ref<boolean | null>(null)

  async function refresh() {
    try {
      granted.value = await commands.notificationPermissionGranted()
    } catch {
      granted.value = null
    }
  }

  function openSettings() {
    commands.openOsNotificationSettings().catch(() => {
      // 設定を開けなくても他の操作には影響しない
    })
  }

  return { granted, refresh, openSettings }
}

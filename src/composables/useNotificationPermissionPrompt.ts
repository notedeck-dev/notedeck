import { watch } from 'vue'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useUiStore } from '@/stores/ui'
import { commands } from '@/utils/tauriInvoke'

/**
 * 通知の権限 (Android 13 以上) を、起動時ではなく最初の口座を追加した直後に求める
 * (#330 §4.5)。利用者が通知のことを考えている瞬間に 1 度だけ、仕組みの説明
 * (開いている間はすぐ届く / 閉じている間は定期的に確認) を挟んでから OS の
 * ダイアログを出す。権限ダイアログの無い OS でも説明は同じ (仕組みは OS を問わない)。
 *
 * 2 つ目以降の口座や、起動時に口座が既にある場合は求めない。拒否が重なって OS が
 * ダイアログを出さなくなった後は、アカウントメニューの状態行から OS の設定へ飛べる。
 */
export function useNotificationPermissionPrompt(): void {
  const ui = useUiStore()
  if (!ui.isMobilePlatform) return
  const accounts = useAccountsStore()
  const tokenCount = () => accounts.accounts.filter((a) => a.hasToken).length

  let prompted = false
  watch(tokenCount, async (now, before) => {
    if (prompted || before !== 0 || now !== 1) return
    prompted = true
    await useConfirm().confirm({
      title: i18n.ts._notifyPermission.title,
      message: i18n.ts._notifyPermission.message,
      hideCancel: true,
    })
    commands.requestNotificationPermission().catch(() => {
      // 権限が求められなくても口座の追加は成功している
    })
  })
}

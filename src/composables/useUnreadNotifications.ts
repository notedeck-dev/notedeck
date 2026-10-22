import { showPermissionReloginPrompt } from '@/composables/useLoginPrompt'
import { useUnreadCounter } from '@/composables/useUnreadCounter'
import { useAccountsStore } from '@/stores/accounts'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

async function fetchUnreadCount(accountId: string): Promise<number> {
  try {
    return unwrap(await commands.apiGetUnreadNotificationCount(accountId))
  } catch {
    return 0
  }
}

export function useUnreadNotifications() {
  const { totalUnread, counts, fetchAll, resetAll } = useUnreadCounter(
    'notifications',
    {
      pollIntervalKey: 'notificationPollInterval',
      fetchCount: fetchUnreadCount,
      onUnread: (event, current) => {
        if (event.kind !== 'notification') return null
        return event.op === 'clear' ? 0 : current + 1
      },
    },
  )

  async function markAllAsRead() {
    const accountsStore = useAccountsStore()
    for (const acc of accountsStore.accounts) {
      if (!acc.hasToken) continue
      try {
        unwrap(await commands.apiMarkAllNotificationsAsRead(acc.id))
      } catch (e) {
        // `write:notifications` は後から要求に足した権限。以前のトークンの口座は
        // 再ログインしてもらう。それ以外の失敗は非致命
        if (AppError.from(e).apiCode === 'PERMISSION_DENIED') {
          showPermissionReloginPrompt(acc.id)
        }
      }
    }
    resetAll()
  }

  return { totalUnread, counts, markAllAsRead, fetchAll }
}

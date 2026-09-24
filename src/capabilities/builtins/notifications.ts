import type { Command } from '@/commands/registry'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { implement, implementCore } from '../declare'

/**
 * `notifications.list` — 通知一覧を取得する read 系 capability。
 * 通知本文 (リアクション元 / リプライ元のノート) は projectVisibleItems の
 * 'notifications' kind で軽量化された projection が返る。
 */
export const notificationsListCapability = implementCore('notifications.list')

/**
 * `notifications.markRead` — 指定アカウントの通知をすべて既読化する
 * (Misskey `notifications/mark-all-as-read`)。AI が「通知整理して」「全部
 * 既読にして」と言われたときに使う。読み逃しのリスクがあるので確認 UI 必須。
 */
export const notificationsMarkReadCapability = implement(
  'notifications.markRead',
  {
    requiresConfirmation: (params) => {
      const accountId =
        typeof params?.accountId === 'string' ? params.accountId : ''
      return {
        title: '通知をすべて既読化',
        message: accountId
          ? `アカウント \`${accountId}\` の通知をすべて既読化します。`
          : 'ログイン中の全アカウントの通知をすべて既読化します。',
        okLabel: '既読化',
        cancelLabel: 'やめる',
        type: 'warning',
      }
    },
    execute: async (params) => {
      const explicitId =
        typeof params?.accountId === 'string' &&
        params.accountId.trim().length > 0
          ? params.accountId.trim()
          : null
      const accountsStore = useAccountsStore()
      const targetIds = explicitId
        ? [explicitId]
        : accountsStore.accounts.filter((a) => a.hasToken).map((a) => a.id)
      let marked = 0
      for (const id of targetIds) {
        try {
          unwrap(await commands.apiMarkAllNotificationsAsRead(id))
          marked++
        } catch (e) {
          console.warn(`[notifications.markRead] account ${id} failed:`, e)
        }
      }
      return { markedAccounts: marked }
    },
  },
)

export const NOTIFICATIONS_BUILTIN_CAPABILITIES: readonly Command[] = [
  notificationsListCapability,
  notificationsMarkReadCapability,
]

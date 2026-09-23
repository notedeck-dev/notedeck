import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

/**
 * AI が 1 回の呼び出しで取得できる通知の上限 (Misskey API native 上限と一致)。
 * untilId で続きを引けるので「もっと取って」と AI に頼めばページング可能。
 */
const MAX_NOTIFICATIONS_PER_CALL = 100
const DEFAULT_LIMIT = 10

function clampLimit(input: unknown, fallback = DEFAULT_LIMIT): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.max(1, Math.min(MAX_NOTIFICATIONS_PER_CALL, Math.floor(input)))
}

function pickUntilId(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * `notifications.list` — 通知一覧を取得する read 系 capability。
 * 通知本文 (リアクション元 / リプライ元のノート) は projectVisibleItems の
 * 'notifications' kind で軽量化された projection が返る。
 */
export const notificationsListCapability = implement('notifications.list', {
  execute: async (params, ctx) => {
    const limit = clampLimit(params?.limit)
    const untilId = pickUntilId(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notifications = await api.getNotifications({ limit, untilId })
    return projectVisibleItems(notifications, 'notifications', limit)
  },
})

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

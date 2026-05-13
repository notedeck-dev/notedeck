import { initAdapterFor } from '@/adapters/factory'
import type { ApiAdapter } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * AI が 1 回の呼び出しで取得できる通知の上限 (Misskey API native 上限と一致)。
 * untilId で続きを引けるので「もっと取って」と AI に頼めばページング可能。
 */
const MAX_NOTIFICATIONS_PER_CALL = 100
const DEFAULT_LIMIT = 10

async function getApiAdapter(
  accountId: string | undefined,
): Promise<ApiAdapter> {
  const store = useAccountsStore()
  const id = accountId ?? store.activeAccountId
  if (!id) throw new Error('No active account')
  const acc = store.accounts.find((a) => a.id === id)
  if (!acc) throw new Error(`Account "${id}" not found`)
  const { adapter } = await initAdapterFor(acc.host, acc.id)
  return adapter.api
}

function clampLimit(input: unknown, fallback = DEFAULT_LIMIT): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.max(1, Math.min(MAX_NOTIFICATIONS_PER_CALL, Math.floor(input)))
}

function pickUntilId(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function pickAccountId(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * `notifications.list` — 通知一覧を取得する read 系 capability。
 * 通知本文 (リアクション元 / リプライ元のノート) は projectVisibleItems の
 * 'notifications' kind で軽量化された projection が返る。
 */
export const notificationsListCapability: Command = {
  id: 'notifications.list',
  label: '通知一覧',
  icon: 'ti-bell',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['notifications'],
  signature: {
    description:
      '指定アカウント (未指定なら active) の通知一覧を取得する。' +
      ' type / userId / noteId / reaction / createdAt 等の projection が返る。' +
      ' 100 件を超えて取得したい場合は、最後の通知の id を untilId に渡して再呼び出し。' +
      ' 別サーバーの通知を読むときは `<currentColumn>.accountId` を渡す。',
    params: {
      limit: {
        type: 'number',
        description: '取得件数 (1-100, default 10)',
        optional: true,
      },
      untilId: {
        type: 'string',
        description:
          'この ID より前の通知を取得 (ページング用)。前回呼び出しの最後の通知の id を渡す。',
        optional: true,
      },
      accountId: {
        type: 'string',
        description:
          'どのアカウントの通知を取るか。未指定なら active アカウント。' +
          ' 別サーバーのカラムを読むときは `<currentColumn>.accountId` を渡す。',
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description: '通知 projection の配列',
    },
  },
  visible: false,
  execute: async (params) => {
    const limit = clampLimit(params?.limit)
    const untilId = pickUntilId(params?.untilId)
    const accountId = pickAccountId(params?.accountId)
    const api = await getApiAdapter(accountId)
    const notifications = await api.getNotifications({ limit, untilId })
    return projectVisibleItems(notifications, 'notifications', limit)
  },
}

/**
 * `notifications.markRead` — 指定アカウントの通知をすべて既読化する
 * (Misskey `notifications/mark-all-as-read`)。AI が「通知整理して」「全部
 * 既読にして」と言われたときに使う。読み逃しのリスクがあるので確認 UI 必須。
 */
export const notificationsMarkReadCapability: Command = {
  id: 'notifications.markRead',
  label: '通知をすべて既読化',
  icon: 'ti-bell-check',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['notifications'],
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
  signature: {
    description:
      '指定アカウントの通知をすべて既読化する (= Misskey ' +
      '`notifications/mark-all-as-read`)。未読バッジが消える。' +
      ' accountId を省略すると hasToken な全アカウントに対して実行する。',
    params: {
      accountId: {
        type: 'string',
        description:
          'どのアカウントを既読化するか。省略時は全アカウント。' +
          ' 別サーバーのカラムから操作するときは `<currentColumn>.accountId` を渡す。',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ markedAccounts: 既読化を実行したアカウント数 }',
    },
  },
  visible: false,
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
}

export const NOTIFICATIONS_BUILTIN_CAPABILITIES: readonly Command[] = [
  notificationsListCapability,
  notificationsMarkReadCapability,
]

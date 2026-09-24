import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

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
export const notificationsMarkReadCapability = implementCore(
  'notifications.markRead',
)

export const NOTIFICATIONS_BUILTIN_CAPABILITIES: readonly Command[] = [
  notificationsListCapability,
  notificationsMarkReadCapability,
]

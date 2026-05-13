import type { Command } from '@/commands/registry'
import { ACCOUNT_BUILTIN_CAPABILITIES } from './account'
import { AI_BUILTIN_CAPABILITIES } from './ai'
import { AI_SESSIONS_BUILTIN_CAPABILITIES } from './aiSessions'
import { CLIPBOARD_BUILTIN_CAPABILITIES } from './clipboard'
import { COLUMN_BUILTIN_CAPABILITIES } from './column'
import { DRIVE_BUILTIN_CAPABILITIES } from './drive'
import { HTTP_BUILTIN_CAPABILITIES } from './http'
import { LOGS_BUILTIN_CAPABILITIES } from './logs'
import { MEMOS_BUILTIN_CAPABILITIES } from './memos'
import { MEMOS_READ_BUILTIN_CAPABILITIES } from './memos-read'
import { META_BUILTIN_CAPABILITIES } from './meta'
import { MISSTORE_BUILTIN_CAPABILITIES } from './misstore'
import { NOTES_BUILTIN_CAPABILITIES } from './notes'
import { NOTES_WRITE_BUILTIN_CAPABILITIES } from './notes-write'
import { NOTIFICATIONS_BUILTIN_CAPABILITIES } from './notifications'
import { PERFORMANCE_BUILTIN_CAPABILITIES } from './performance'
import { PLUGINS_BUILTIN_CAPABILITIES } from './plugins'
import { SKILLS_BUILTIN_CAPABILITIES } from './skills'
import { TASKS_BUILTIN_CAPABILITIES } from './tasks'
import { THEME_BUILTIN_CAPABILITIES } from './theme'
import { BUILTIN_CAPABILITIES as TIME_BUILTIN_CAPABILITIES } from './time'
import { UI_BUILTIN_CAPABILITIES } from './ui'
import { USER_BUILTIN_CAPABILITIES } from './user'
import { WIDGETS_BUILTIN_CAPABILITIES } from './widgets'

/**
 * NoteDeck に同梱されている AI tool として公開可能な capability の集合。
 * `main.ts` で起動時にこれらを `registerCapability` する。
 *
 * 命名規約: capability id はドット区切り (`<subject>.<verb>` 形式)。
 * Anthropic / OpenAI の tool name 制約に合わせて `toolSchema.ts` で
 * `_` に変換される (`time.now` → `time_now`)。
 */
export const ALL_BUILTIN_CAPABILITIES: readonly Command[] = [
  ...TIME_BUILTIN_CAPABILITIES,
  ...ACCOUNT_BUILTIN_CAPABILITIES,
  ...COLUMN_BUILTIN_CAPABILITIES,
  ...THEME_BUILTIN_CAPABILITIES,
  ...NOTES_BUILTIN_CAPABILITIES,
  ...NOTES_WRITE_BUILTIN_CAPABILITIES,
  ...USER_BUILTIN_CAPABILITIES,
  ...NOTIFICATIONS_BUILTIN_CAPABILITIES,
  ...DRIVE_BUILTIN_CAPABILITIES,
  ...HTTP_BUILTIN_CAPABILITIES,
  ...MEMOS_BUILTIN_CAPABILITIES,
  ...MEMOS_READ_BUILTIN_CAPABILITIES,
  ...TASKS_BUILTIN_CAPABILITIES,
  ...UI_BUILTIN_CAPABILITIES,
  ...AI_BUILTIN_CAPABILITIES,
  ...SKILLS_BUILTIN_CAPABILITIES,
  ...WIDGETS_BUILTIN_CAPABILITIES,
  ...PLUGINS_BUILTIN_CAPABILITIES,
  ...PERFORMANCE_BUILTIN_CAPABILITIES,
  ...CLIPBOARD_BUILTIN_CAPABILITIES,
  ...META_BUILTIN_CAPABILITIES,
  ...AI_SESSIONS_BUILTIN_CAPABILITIES,
  ...LOGS_BUILTIN_CAPABILITIES,
  ...MISSTORE_BUILTIN_CAPABILITIES,
]

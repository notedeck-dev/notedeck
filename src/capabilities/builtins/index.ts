import type { Command } from '@/commands/registry'
import { ACCOUNT_BUILTIN_CAPABILITIES } from './account'
import { COLUMN_BUILTIN_CAPABILITIES } from './column'
import { DRIVE_BUILTIN_CAPABILITIES } from './drive'
import { HTTP_BUILTIN_CAPABILITIES } from './http'
import { MEMOS_BUILTIN_CAPABILITIES } from './memos'
import { MEMOS_READ_BUILTIN_CAPABILITIES } from './memos-read'
import { NOTES_BUILTIN_CAPABILITIES } from './notes'
import { NOTES_WRITE_BUILTIN_CAPABILITIES } from './notes-write'
import { NOTIFICATIONS_BUILTIN_CAPABILITIES } from './notifications'
import { TASKS_BUILTIN_CAPABILITIES } from './tasks'
import { THEME_BUILTIN_CAPABILITIES } from './theme'
import { BUILTIN_CAPABILITIES as TIME_BUILTIN_CAPABILITIES } from './time'
import { USER_BUILTIN_CAPABILITIES } from './user'

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
]

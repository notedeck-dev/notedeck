import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const announcementsListCapability = implementCore('announcements.list')

export const ANNOUNCEMENTS_BUILTIN_CAPABILITIES: readonly Command[] = [
  announcementsListCapability,
]

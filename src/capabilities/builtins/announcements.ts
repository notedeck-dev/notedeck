import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const announcementsListCapability = implementCore('announcements.list')

export const ANNOUNCEMENTS_BUILTIN_CAPABILITIES: readonly Capability[] = [
  announcementsListCapability,
]

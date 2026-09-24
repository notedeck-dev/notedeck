import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const channelListCapability = implementCore('channel.list')

export const channelNotesCapability = implementCore('channel.notes')

export const CHANNEL_BUILTIN_CAPABILITIES: readonly Command[] = [
  channelListCapability,
  channelNotesCapability,
]

import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const chatReactCapability = implementCore('chat.react')

export const chatUnreactCapability = implementCore('chat.unreact')

export const CHAT_BUILTIN_CAPABILITIES: readonly Command[] = [
  chatReactCapability,
  chatUnreactCapability,
]

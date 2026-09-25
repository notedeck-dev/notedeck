import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const listListCapability = implementCore('list.list')

export const listAddUserCapability = implementCore('list.addUser')

export const listRemoveUserCapability = implementCore('list.removeUser')

export const LIST_BUILTIN_CAPABILITIES: readonly Command[] = [
  listListCapability,
  listAddUserCapability,
  listRemoveUserCapability,
]

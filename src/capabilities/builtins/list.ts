import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const listListCapability = implementCore('list.list')

export const listAddUserCapability = implementCore('list.addUser')

export const listRemoveUserCapability = implementCore('list.removeUser')

export const LIST_BUILTIN_CAPABILITIES: readonly Capability[] = [
  listListCapability,
  listAddUserCapability,
  listRemoveUserCapability,
]

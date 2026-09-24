import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const roleNotesCapability = implementCore('role.notes')

export const ROLE_BUILTIN_CAPABILITIES: readonly Command[] = [
  roleNotesCapability,
]

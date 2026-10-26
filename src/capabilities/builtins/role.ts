import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const roleNotesCapability = implementCore('role.notes')

export const ROLE_BUILTIN_CAPABILITIES: readonly Capability[] = [
  roleNotesCapability,
]

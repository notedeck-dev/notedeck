import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const misstoreSearchCapability = implementCore('misstore.search')

export const MISSTORE_BUILTIN_CAPABILITIES: readonly Command[] = [
  misstoreSearchCapability,
]

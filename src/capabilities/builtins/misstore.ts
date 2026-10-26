import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const misstoreSearchCapability = implementCore('misstore.search')

export const MISSTORE_BUILTIN_CAPABILITIES: readonly Capability[] = [
  misstoreSearchCapability,
]

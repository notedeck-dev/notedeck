import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const antennaListCapability = implementCore('antenna.list')

export const antennaNotesCapability = implementCore('antenna.notes')

export const ANTENNA_BUILTIN_CAPABILITIES: readonly Capability[] = [
  antennaListCapability,
  antennaNotesCapability,
]

import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const antennaListCapability = implementCore('antenna.list')

export const antennaNotesCapability = implementCore('antenna.notes')

export const ANTENNA_BUILTIN_CAPABILITIES: readonly Command[] = [
  antennaListCapability,
  antennaNotesCapability,
]

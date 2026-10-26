import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const clipsListCapability = implementCore('clips.list')

export const clipsNotesCapability = implementCore('clips.notes')

export const clipsCreateCapability = implementCore('clips.create')

export const clipsAddNoteCapability = implementCore('clips.addNote')

export const clipsRemoveNoteCapability = implementCore('clips.removeNote')

export const CLIPS_BUILTIN_CAPABILITIES: readonly Capability[] = [
  clipsListCapability,
  clipsNotesCapability,
  clipsCreateCapability,
  clipsAddNoteCapability,
  clipsRemoveNoteCapability,
]

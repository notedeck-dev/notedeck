import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const clipsListCapability = implementCore('clips.list')

export const clipsNotesCapability = implementCore('clips.notes')

export const clipsCreateCapability = implementCore('clips.create')

export const clipsAddNoteCapability = implementCore('clips.addNote')

export const clipsRemoveNoteCapability = implementCore('clips.removeNote')

export const CLIPS_BUILTIN_CAPABILITIES: readonly Command[] = [
  clipsListCapability,
  clipsNotesCapability,
  clipsCreateCapability,
  clipsAddNoteCapability,
  clipsRemoveNoteCapability,
]

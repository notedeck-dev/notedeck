import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const galleryListCapability = implementCore('gallery.list')

export const GALLERY_BUILTIN_CAPABILITIES: readonly Command[] = [
  galleryListCapability,
]

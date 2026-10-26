import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const galleryListCapability = implementCore('gallery.list')

export const GALLERY_BUILTIN_CAPABILITIES: readonly Capability[] = [
  galleryListCapability,
]

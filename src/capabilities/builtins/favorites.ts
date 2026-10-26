import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const favoritesAddCapability = implementCore('favorites.add')

export const favoritesRemoveCapability = implementCore('favorites.remove')

export const FAVORITES_BUILTIN_CAPABILITIES: readonly Capability[] = [
  favoritesAddCapability,
  favoritesRemoveCapability,
]

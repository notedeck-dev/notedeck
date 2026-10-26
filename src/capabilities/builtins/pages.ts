import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const pagesListCapability = implementCore('pages.list')

export const pagesShowCapability = implementCore('pages.show')

export const PAGES_BUILTIN_CAPABILITIES: readonly Capability[] = [
  pagesListCapability,
  pagesShowCapability,
]

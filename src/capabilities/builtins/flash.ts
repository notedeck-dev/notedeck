import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const flashListCapability = implementCore('flash.list')

export const flashShowCapability = implementCore('flash.show')

export const FLASH_BUILTIN_CAPABILITIES: readonly Capability[] = [
  flashListCapability,
  flashShowCapability,
]

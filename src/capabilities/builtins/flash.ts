import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const flashListCapability = implementCore('flash.list')

export const flashShowCapability = implementCore('flash.show')

export const FLASH_BUILTIN_CAPABILITIES: readonly Command[] = [
  flashListCapability,
  flashShowCapability,
]

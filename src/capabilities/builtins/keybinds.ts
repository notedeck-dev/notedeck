import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const keybindsListCapability = implementCore('keybinds.list')

export const keybindsSetCapability = implementCore('keybinds.set')

export const keybindsResetCapability = implementCore('keybinds.reset')

export const keybindsResetAllCapability = implementCore('keybinds.resetAll')

export const KEYBINDS_BUILTIN_CAPABILITIES: readonly Command[] = [
  keybindsListCapability,
  keybindsSetCapability,
  keybindsResetCapability,
  keybindsResetAllCapability,
]

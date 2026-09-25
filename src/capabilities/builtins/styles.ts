import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const stylesReadCapability = implementCore('styles.read')

export const stylesWriteCapability = implementCore('styles.write')

export const stylesAppendCapability = implementCore('styles.append')

export const stylesHistoryCapability = implementCore('styles.history')

export const stylesRevertCapability = implementCore('styles.revert')

export const STYLES_BUILTIN_CAPABILITIES: readonly Command[] = [
  stylesReadCapability,
  stylesWriteCapability,
  stylesAppendCapability,
  stylesHistoryCapability,
  stylesRevertCapability,
]

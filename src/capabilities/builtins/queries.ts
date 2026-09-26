import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const queriesHistoryCapability = implementCore('queries.history')

export const queriesRevertCapability = implementCore('queries.revert')

export const QUERIES_BUILTIN_CAPABILITIES: readonly Command[] = [
  queriesHistoryCapability,
  queriesRevertCapability,
]

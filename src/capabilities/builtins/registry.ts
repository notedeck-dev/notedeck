import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

export const registryListKeysCapability = implementCore('registry.listKeys')

export const registryGetCapability = implementCore('registry.get')

export const registrySetCapability = implementCore('registry.set')

export const registryDeleteCapability = implementCore('registry.delete')

export const REGISTRY_BUILTIN_CAPABILITIES: readonly Command[] = [
  registryListKeysCapability,
  registryGetCapability,
  registrySetCapability,
  registryDeleteCapability,
]

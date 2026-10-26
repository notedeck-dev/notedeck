import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const registryListKeysCapability = implementCore('registry.listKeys')

export const registryGetCapability = implementCore('registry.get')

export const registrySetCapability = implementCore('registry.set')

export const registryDeleteCapability = implementCore('registry.delete')

export const REGISTRY_BUILTIN_CAPABILITIES: readonly Capability[] = [
  registryListKeysCapability,
  registryGetCapability,
  registrySetCapability,
  registryDeleteCapability,
]

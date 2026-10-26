import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

export const performanceListCapability = implementCore('performance.list')

export const performanceSetCapability = implementCore('performance.set')

export const performanceResetCapability = implementCore('performance.reset')

export const performanceResetAllCapability = implementCore(
  'performance.resetAll',
)

export const performanceApplySliderCapability = implementCore(
  'performance.applySlider',
)

export const PERFORMANCE_BUILTIN_CAPABILITIES: readonly Capability[] = [
  performanceListCapability,
  performanceSetCapability,
  performanceResetCapability,
  performanceResetAllCapability,
  performanceApplySliderCapability,
]

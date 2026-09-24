import { describe, expect, it } from 'vitest'
import {
  FEDERATION_BUILTIN_CAPABILITIES,
  federationChartCapability,
  federationInstanceCapability,
  federationInstancesCapability,
} from './federation'

describe('federation capabilities — declaration', () => {
  it.each([
    ['federation.chart', federationChartCapability] as const,
    ['federation.instances', federationInstancesCapability] as const,
    ['federation.instance', federationInstanceCapability] as const,
  ])('%s: account.read, cheap, aiTool', (id, cap) => {
    expect(cap.id).toBe(id)
    expect(cap.permissions).toEqual(['account.read'])
    expect(cap.signature?.cheap).toBe(true)
    expect(cap.aiTool).toBe(true)
  })
})

describe('FEDERATION_BUILTIN_CAPABILITIES', () => {
  it('contains chart / instances / instance', () => {
    const ids = FEDERATION_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'federation.chart',
      'federation.instance',
      'federation.instances',
    ])
  })
})

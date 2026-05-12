import { afterEach, describe, expect, it } from 'vitest'
import type { Command } from '@/commands/registry'
import {
  _clearCapabilitiesForTest,
  getCapability,
  listCapabilities,
  registerCapability,
  unregisterCapability,
} from './registry'

function makeCapability(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.cap',
    label: 'test',
    icon: 'ti-flask',
    category: 'general',
    shortcuts: [],
    aiTool: true,
    signature: { description: 'test capability' },
    execute: () => 'ok',
    ...overrides,
  }
}

afterEach(() => {
  _clearCapabilitiesForTest()
})

describe('registry', () => {
  it('registers and looks up a capability by id', () => {
    const cap = makeCapability({ id: 'a.read' })
    registerCapability(cap)
    expect(getCapability('a.read')).toBe(cap)
  })

  it('registers a command with aiTool: false (= AI 本体からは呼べないが他経路は OK)', () => {
    const cap = makeCapability({ id: 'no-ai', aiTool: false })
    registerCapability(cap)
    expect(getCapability('no-ai')).toBe(cap)
  })

  it('throws when registering a command without signature', () => {
    expect(() =>
      registerCapability(makeCapability({ signature: undefined })),
    ).toThrow(/signature/)
  })

  it('overwrites a capability when the same id is registered twice', () => {
    registerCapability(makeCapability({ id: 'x', label: 'first' }))
    registerCapability(makeCapability({ id: 'x', label: 'second' }))
    expect(getCapability('x')?.label).toBe('second')
  })

  it('unregisters a capability', () => {
    registerCapability(makeCapability({ id: 'gone' }))
    unregisterCapability('gone')
    expect(getCapability('gone')).toBeUndefined()
  })

  it('lists all registered capabilities', () => {
    registerCapability(makeCapability({ id: 'a' }))
    registerCapability(makeCapability({ id: 'b' }))
    const ids = listCapabilities().map((c) => c.id)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(ids).toHaveLength(2)
  })

  it('returns undefined for unknown id', () => {
    expect(getCapability('not-here')).toBeUndefined()
  })
})

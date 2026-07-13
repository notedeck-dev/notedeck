import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAiScriptLogsStore } from '@/stores/aiscriptLogs'
import {
  AISCRIPT_BUILTIN_CAPABILITIES,
  aiscriptLogsCapability,
  aiscriptValidateCapability,
  preflightValidateSrc,
} from './aiscript'

describe('aiscript.validate capability — declaration', () => {
  it('exposes the expected metadata', () => {
    expect(aiscriptValidateCapability.id).toBe('aiscript.validate')
    expect(aiscriptValidateCapability.aiTool).toBe(true)
    expect(aiscriptValidateCapability.permissions).toEqual([])
    expect(aiscriptValidateCapability.signature?.cheap).toBe(true)
  })

  it('is included in AISCRIPT_BUILTIN_CAPABILITIES', () => {
    expect(AISCRIPT_BUILTIN_CAPABILITIES.map((c) => c.id)).toContain(
      'aiscript.validate',
    )
  })
})

describe('aiscript.validate capability — execute', () => {
  it('throws when src is missing', () => {
    expect(() => aiscriptValidateCapability.execute({})).toThrow(
      /src is required/,
    )
  })

  it('returns ok: true for valid AiScript', () => {
    const r = aiscriptValidateCapability.execute({
      src: 'let x = 1',
    }) as { ok: boolean; diagnostics: unknown[] }
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
  })

  it('returns ok: false with diagnostics for broken AiScript', () => {
    const r = aiscriptValidateCapability.execute({
      src: 'let x = ',
    }) as { ok: boolean; diagnostics: Array<{ severity: string }> }
    expect(r.ok).toBe(false)
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.diagnostics[0]?.severity).toBe('error')
  })

  it('accepts entryPoint param without throwing', () => {
    const r = aiscriptValidateCapability.execute({
      src: 'let x = 1',
      entryPoint: 'plugin',
    }) as { ok: boolean }
    expect(r.ok).toBe(true)
  })
})

describe('aiscript.logs capability — declaration', () => {
  it('reuses logs.read permission and exposes the expected metadata', () => {
    expect(aiscriptLogsCapability.id).toBe('aiscript.logs')
    expect(aiscriptLogsCapability.aiTool).toBe(true)
    expect(aiscriptLogsCapability.permissions).toEqual(['logs.read'])
    expect(aiscriptLogsCapability.signature?.cheap).toBe(true)
    expect(aiscriptLogsCapability.signature?.params?.source?.optional).toBe(
      true,
    )
    expect(aiscriptLogsCapability.signature?.params?.level?.optional).toBe(true)
  })

  it('is included in AISCRIPT_BUILTIN_CAPABILITIES', () => {
    expect(AISCRIPT_BUILTIN_CAPABILITIES.map((c) => c.id)).toContain(
      'aiscript.logs',
    )
  })
})

describe('aiscript.logs capability — execute', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('returns entries newest-first with filters applied', () => {
    const store = useAiScriptLogsStore()
    const run = store.beginRun('plugin', 'p1', 'My Plugin')
    run.print('out')
    run.error('boom')
    store.beginRun('widget', 'w1').print('w-out')

    const all = aiscriptLogsCapability.execute({}) as Array<{
      message: string
    }>
    expect(all[0]?.message).toBe('w-out')

    const errors = aiscriptLogsCapability.execute({
      level: 'error',
    }) as Array<{ message: string }>
    expect(errors.map((e) => e.message)).toEqual(['boom'])

    const pluginOnly = aiscriptLogsCapability.execute({
      source: 'plugin',
      sourceId: 'p1',
      limit: 2,
    }) as Array<{ source: string; sourceId: string }>
    expect(pluginOnly).toHaveLength(2)
    expect(
      pluginOnly.every((e) => e.source === 'plugin' && e.sourceId === 'p1'),
    ).toBe(true)
  })

  it('ignores invalid params and falls back to defaults', () => {
    const store = useAiScriptLogsStore()
    store.beginRun('play', 'f1').print('x')
    const r = aiscriptLogsCapability.execute({
      source: 'bogus',
      level: 42,
      limit: 'many',
    }) as unknown[]
    expect(r.length).toBeGreaterThan(0)
  })
})

describe('preflightValidateSrc helper', () => {
  it('returns null when src is missing (= dispatcher proceeds to confirm)', () => {
    expect(preflightValidateSrc({}, 'plugin')).toBeNull()
    expect(preflightValidateSrc(undefined, 'widget')).toBeNull()
  })

  it('returns null when src is syntactically valid', () => {
    expect(preflightValidateSrc({ src: 'let x = 1' }, 'plugin')).toBeNull()
  })

  it('returns a PreflightFailure with diagnostics JSON when src is broken', () => {
    const r = preflightValidateSrc({ src: 'let x = (' }, 'plugin')
    expect(r).not.toBeNull()
    expect(r?.error).toContain('構文エラー')
    expect(r?.error).toContain('diagnostics:')
    // diagnostics JSON が AI 側で parse できる形で埋まっている
    const jsonStart = r?.error.indexOf('[')
    expect(jsonStart).toBeGreaterThan(-1)
    if (jsonStart !== undefined && jsonStart > -1 && r) {
      const diagnostics = JSON.parse(r.error.slice(jsonStart))
      expect(Array.isArray(diagnostics)).toBe(true)
      expect(diagnostics[0]?.severity).toBe('error')
    }
  })
})

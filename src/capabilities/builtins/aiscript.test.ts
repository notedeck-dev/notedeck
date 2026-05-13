import { describe, expect, it } from 'vitest'
import {
  AISCRIPT_BUILTIN_CAPABILITIES,
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

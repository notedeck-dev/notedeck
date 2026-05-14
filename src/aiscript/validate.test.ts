import { describe, expect, it } from 'vitest'
import { validateAiScript } from './validate'

describe('validateAiScript', () => {
  it('returns ok: true with empty diagnostics for valid AiScript', () => {
    const r = validateAiScript('let x = 1\nlet y = x + 2')
    expect(r).toEqual({ ok: true, diagnostics: [] })
  })

  it('returns ok: true for empty / whitespace-only source', () => {
    expect(validateAiScript('').ok).toBe(true)
    expect(validateAiScript('   \n\t  ').ok).toBe(true)
  })

  it('returns ok: false with diagnostics for syntax error', () => {
    const r = validateAiScript('let x = ')
    expect(r.ok).toBe(false)
    expect(r.diagnostics.length).toBeGreaterThan(0)
    expect(r.diagnostics[0]?.severity).toBe('error')
    expect(r.diagnostics[0]?.line).toBeGreaterThanOrEqual(1)
  })

  it('reports a 1-based line number on multi-line errors', () => {
    const src = ['let a = 1', 'let b = 2', 'let c = ('].join('\n')
    const r = validateAiScript(src)
    expect(r.ok).toBe(false)
    expect(r.diagnostics[0]?.line).toBeGreaterThanOrEqual(1)
  })

  it('strips BOM and zero-width chars before parsing', () => {
    const r = validateAiScript('﻿let ​x = 1')
    expect(r.ok).toBe(true)
  })

  it('accepts entryPoint option without throwing', () => {
    const r = validateAiScript('let x = 1', { entryPoint: 'plugin' })
    expect(r.ok).toBe(true)
  })
})

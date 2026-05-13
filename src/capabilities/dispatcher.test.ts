import { afterEach, describe, expect, it } from 'vitest'
import type { Command } from '@/commands/registry'
import {
  type AiConfig,
  defaultConfig,
  setPermissionPreset,
} from '@/composables/useAiConfig'
import { dispatchCapability } from './dispatcher'
import { _clearCapabilitiesForTest, registerCapability } from './registry'

function makeCapability(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.cap',
    label: 'test',
    icon: 'ti-flask',
    category: 'general',
    shortcuts: [],
    aiTool: true,
    permissions: [],
    signature: { description: 'test capability' },
    execute: () => 'ok',
    ...overrides,
  }
}

function configWithPreset(preset: 'readonly' | 'safe' | 'full'): AiConfig {
  const cfg = defaultConfig()
  cfg.permissions = setPermissionPreset(cfg.permissions, preset)
  return cfg
}

afterEach(() => {
  _clearCapabilitiesForTest()
})

describe('dispatchCapability', () => {
  it('returns ok + result for a registered no-permission capability', async () => {
    registerCapability(makeCapability({ id: 'a', execute: () => 'hello' }))
    const r = await dispatchCapability(
      'a',
      undefined,
      configWithPreset('readonly'),
    )
    expect(r).toEqual({ ok: true, result: 'hello' })
  })

  it('returns unknown_capability for an unregistered id', async () => {
    const r = await dispatchCapability('not-here', {}, configWithPreset('full'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('unknown_capability')
      expect(r.error).toContain('not-here')
    }
  })

  it('returns permission_denied when required permissions are not allowed', async () => {
    registerCapability(
      makeCapability({ id: 'notes.post', permissions: ['notes.write'] }),
    )
    const r = await dispatchCapability(
      'notes.post',
      { text: 'hi' },
      configWithPreset('readonly'), // notes.write は false
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('permission_denied')
      expect(r.error).toContain('notes.write')
    }
  })

  it('passes when all required permissions are allowed', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.react',
        permissions: ['notes.react'],
        execute: () => 'reacted',
      }),
    )
    const r = await dispatchCapability(
      'notes.react',
      undefined,
      configWithPreset('safe'), // notes.react は true
    )
    expect(r).toEqual({ ok: true, result: 'reacted' })
  })

  it('returns execute_failed when the capability throws', async () => {
    registerCapability(
      makeCapability({
        id: 'broken',
        execute: () => {
          throw new Error('boom')
        },
      }),
    )
    const r = await dispatchCapability(
      'broken',
      undefined,
      configWithPreset('full'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('execute_failed')
      expect(r.error).toContain('boom')
    }
  })

  it('forwards params to execute and supports async execute', async () => {
    let received: unknown = null
    registerCapability(
      makeCapability({
        id: 'echo',
        execute: async (params) => {
          received = params
          return params
        },
      }),
    )
    const r = await dispatchCapability(
      'echo',
      { greeting: 'hello' },
      configWithPreset('full'),
    )
    expect(r).toEqual({ ok: true, result: { greeting: 'hello' } })
    expect(received).toEqual({ greeting: 'hello' })
  })

  it('resolves a sanitized tool name back to its dotted capability id', async () => {
    // AI は Anthropic / OpenAI 制約に従って sanitized name (`time_now`)
    // を返す。dispatcher はそれを dotted id (`time.now`) に逆引きできる。
    registerCapability(
      makeCapability({
        id: 'time.now',
        execute: () => 'iso-string',
      }),
    )
    const r = await dispatchCapability(
      'time_now',
      undefined,
      configWithPreset('readonly'),
    )
    expect(r).toEqual({ ok: true, result: 'iso-string' })
  })

  it('still works for capabilities whose id has no dot (no sanitization needed)', async () => {
    registerCapability(makeCapability({ id: 'simple', execute: () => 42 }))
    const r = await dispatchCapability(
      'simple',
      undefined,
      configWithPreset('readonly'),
    )
    expect(r).toEqual({ ok: true, result: 42 })
  })

  it('reports ALL missing permissions when more than one is denied', async () => {
    registerCapability(
      makeCapability({
        id: 'multi',
        permissions: ['notes.write', 'network.external'],
      }),
    )
    const r = await dispatchCapability(
      'multi',
      undefined,
      configWithPreset('readonly'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('notes.write')
      expect(r.error).toContain('network.external')
    }
  })
})

describe('dispatchCapability — confirmation flow', () => {
  it('does NOT invoke confirmFn when capability does not require confirmation', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'a', execute: () => 'ok' }), // no requiresConfirmation
    )
    const r = await dispatchCapability(
      'a',
      undefined,
      configWithPreset('readonly'),
      {
        confirmFn: async () => {
          confirmCalls++
          return true
        },
      },
    )
    expect(r).toEqual({ ok: true, result: 'ok' })
    expect(confirmCalls).toBe(0)
  })

  it('invokes confirmFn before execute when requiresConfirmation: true', async () => {
    const calls: string[] = []
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        requiresConfirmation: true,
        execute: () => {
          calls.push('execute')
          return 'posted'
        },
      }),
    )
    const r = await dispatchCapability(
      'notes.create',
      { text: 'hello' },
      configWithPreset('full'),
      {
        confirmFn: async (opts) => {
          calls.push(`confirm:${opts.title}`)
          return true
        },
      },
    )
    expect(r).toEqual({ ok: true, result: 'posted' })
    // confirm が execute より先に呼ばれている
    expect(calls).toEqual(['confirm:test を実行しますか?', 'execute'])
  })

  it('returns user_cancelled and SKIPS execute when user cancels', async () => {
    let executed = false
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        requiresConfirmation: true,
        execute: () => {
          executed = true
          return 'posted'
        },
      }),
    )
    const r = await dispatchCapability(
      'notes.create',
      { text: 'hello' },
      configWithPreset('full'),
      { confirmFn: async () => false }, // user clicked cancel
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('user_cancelled')
      expect(r.error).toContain('notes.create')
    }
    expect(executed).toBe(false)
  })

  it('uses function-form requiresConfirmation to compose the ConfirmOptions', async () => {
    const seenOpts: { title: string; message: string }[] = []
    registerCapability(
      makeCapability({
        id: 'notes.react',
        permissions: ['notes.react'],
        requiresConfirmation: (params) => ({
          title: 'リアクションする?',
          message: `note=${(params as { noteId?: string })?.noteId} reaction=${(params as { reaction?: string })?.reaction}`,
          type: 'normal',
        }),
        execute: () => 'reacted',
      }),
    )
    const r = await dispatchCapability(
      'notes.react',
      { noteId: 'n1', reaction: '👍' },
      configWithPreset('safe'),
      {
        confirmFn: async (opts) => {
          seenOpts.push({ title: opts.title, message: opts.message })
          return true
        },
      },
    )
    expect(r).toEqual({ ok: true, result: 'reacted' })
    expect(seenOpts).toEqual([
      { title: 'リアクションする?', message: 'note=n1 reaction=👍' },
    ])
  })

  it('runs preflight BEFORE confirm and returns preflight_failed (skipping confirm)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({
        id: 'plugins.create',
        permissions: ['plugins.write'],
        preflight: () => ({ error: 'bad src: diagnostics: [...]' }),
        requiresConfirmation: true,
        execute: () => 'should not run',
      }),
    )
    const r = await dispatchCapability(
      'plugins.create',
      { src: 'broken' },
      configWithPreset('full'),
      {
        confirmFn: async () => {
          confirmCalls++
          return true
        },
      },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('preflight_failed')
      expect(r.error).toContain('diagnostics:')
    }
    expect(confirmCalls).toBe(0)
  })

  it('continues to confirm + execute when preflight returns null', async () => {
    let executed = false
    registerCapability(
      makeCapability({
        id: 'plugins.create',
        permissions: ['plugins.write'],
        preflight: () => null,
        requiresConfirmation: true,
        execute: () => {
          executed = true
          return 'created'
        },
      }),
    )
    const r = await dispatchCapability(
      'plugins.create',
      { src: 'let x = 1' },
      configWithPreset('full'),
      { confirmFn: async () => true },
    )
    expect(r).toEqual({ ok: true, result: 'created' })
    expect(executed).toBe(true)
  })

  it('supports async preflight', async () => {
    registerCapability(
      makeCapability({
        id: 'plugins.create',
        permissions: ['plugins.write'],
        preflight: async () => ({ error: 'async fail' }),
      }),
    )
    const r = await dispatchCapability(
      'plugins.create',
      undefined,
      configWithPreset('full'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('preflight_failed')
      expect(r.error).toBe('async fail')
    }
  })

  it('checks permissions BEFORE confirm (no confirm if denied)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        requiresConfirmation: true,
      }),
    )
    const r = await dispatchCapability(
      'notes.create',
      { text: 'x' },
      configWithPreset('readonly'), // notes.write not allowed
      {
        confirmFn: async () => {
          confirmCalls++
          return true
        },
      },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('permission_denied')
    expect(confirmCalls).toBe(0)
  })
})

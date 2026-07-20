import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliCommandInfo } from '@/bindings'

vi.mock('@/utils/tauriInvoke', () => ({
  commands: { getCliCommands: vi.fn() },
  unwrap: <T>(r: { status: string; data?: T }) => r.data,
}))

function makeRaw(overrides: Partial<CliCommandInfo> = {}): CliCommandInfo {
  return {
    name: 'post',
    about: 'Post a note',
    args: [],
    ...overrides,
  }
}

/** commandCache がモジュールスコープなので毎回リセットして読み直す */
async function loadModule(raw: CliCommandInfo[]) {
  const { commands } = await import('@/utils/tauriInvoke')
  vi.mocked(commands.getCliCommands).mockResolvedValue(raw)
  return import('./cliParser')
}

beforeEach(() => {
  vi.resetModules()
})

describe('loadCliCommands', () => {
  it('excludes daemon/login/logout from the palette', async () => {
    const mod = await loadModule([
      makeRaw({ name: 'post' }),
      makeRaw({ name: 'daemon' }),
      makeRaw({ name: 'login' }),
      makeRaw({ name: 'logout' }),
      makeRaw({ name: 'search' }),
    ])
    const loaded = await mod.loadCliCommands()
    expect(loaded.map((c) => c.name)).toEqual(['post', 'search'])
  })

  it('enriches commands with icon (known mapping and fallback)', async () => {
    const mod = await loadModule([
      makeRaw({ name: 'post' }),
      makeRaw({ name: 'unknown-cmd' }),
    ])
    const [post, unknown] = await mod.loadCliCommands()
    expect(post?.icon).toBe('send')
    expect(unknown?.icon).toBe('terminal')
  })

  it('builds usage string: required as <arg>, defaulted as [arg], optional-without-default omitted', async () => {
    const mod = await loadModule([
      makeRaw({
        name: 'timeline',
        args: [
          { name: 'type', help: null, required: false, default_value: 'home' },
          { name: 'id', help: null, required: true, default_value: null },
          { name: 'silent', help: null, required: false, default_value: null },
        ],
      }),
    ])
    const [meta] = await mod.loadCliCommands()
    expect(meta?.usage).toBe('timeline [type] <id>')
  })

  it('maps needsArgs / defaultValue (snake_case → camelCase)', async () => {
    const mod = await loadModule([
      makeRaw({
        name: 'timeline',
        args: [
          {
            name: 'type',
            help: 'tl type',
            required: false,
            default_value: 'home',
          },
        ],
      }),
      makeRaw({
        name: 'note',
        args: [{ name: 'id', help: null, required: true, default_value: null }],
      }),
    ])
    const [timeline, note] = await mod.loadCliCommands()
    expect(timeline?.needsArgs).toBe(false)
    expect(timeline?.args[0]).toEqual({
      name: 'type',
      help: 'tl type',
      required: false,
      defaultValue: 'home',
    })
    expect(note?.needsArgs).toBe(true)
  })
})

describe('getCliCommands / getCliMeta', () => {
  it('returns empty array before load', async () => {
    const mod = await loadModule([])
    expect(mod.getCliCommands()).toEqual([])
  })

  it('returns cached commands after load and finds meta by name', async () => {
    const mod = await loadModule([makeRaw({ name: 'post' })])
    await mod.loadCliCommands()
    expect(mod.getCliCommands()).toHaveLength(1)
    expect(mod.getCliMeta('post')?.name).toBe('post')
    expect(mod.getCliMeta('nope')).toBeUndefined()
  })
})

describe('parseCliInput', () => {
  async function loaded() {
    const mod = await loadModule([
      makeRaw({ name: 'post' }),
      makeRaw({ name: 'timeline' }),
    ])
    await mod.loadCliCommands()
    return mod
  }

  it('returns null for empty or whitespace-only input', async () => {
    const mod = await loaded()
    expect(mod.parseCliInput('')).toBeNull()
    expect(mod.parseCliInput('   ')).toBeNull()
  })

  it('returns null for unknown command names', async () => {
    const mod = await loaded()
    expect(mod.parseCliInput('frobnicate foo')).toBeNull()
  })

  it('parses a bare command with empty args', async () => {
    const mod = await loaded()
    expect(mod.parseCliInput('timeline')).toEqual({
      name: 'timeline',
      args: '',
    })
  })

  it('splits name and args at the first space, preserving inner spacing', async () => {
    const mod = await loaded()
    expect(mod.parseCliInput('post hello  world')).toEqual({
      name: 'post',
      args: 'hello  world',
    })
  })

  it('trims surrounding whitespace before parsing', async () => {
    const mod = await loaded()
    expect(mod.parseCliInput('  post hi ')).toEqual({
      name: 'post',
      args: 'hi',
    })
  })
})

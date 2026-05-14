import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _clearCapabilitiesForTest,
  registerCapability,
} from '@/capabilities/registry'
import type { Command } from '@/commands/registry'
import type { AiConfig } from './useAiConfig'
import {
  isSlashCommand,
  parseSlashCommand,
  runSlashCommand,
} from './useSlashCommand'

function configWithPreset(preset: 'readonly' | 'safe' | 'full'): AiConfig {
  return {
    activeConnectionId: '',
    models: {},
    permissions: { preset, custom: {} as never },
    dataSources: { preset, custom: {} as never },
  } as unknown as AiConfig
}

const mockTimeNow: Command = {
  id: 'time.now',
  label: 'time.now',
  icon: '',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  signature: {
    description: '現在時刻',
    params: {},
    returns: { type: 'string', description: 'ISO timestamp' },
  },
  visible: false,
  execute: () => '2026-05-01T00:00:00Z',
}

const mockEcho: Command = {
  id: 'echo.say',
  label: 'echo.say',
  icon: '',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.write'],
  signature: {
    description: 'echo back',
    params: {
      msg: { type: 'string', description: 'message' },
      n: { type: 'number', description: 'repeat', optional: true },
    },
    returns: { type: 'string', description: 'echoed' },
  },
  visible: false,
  execute: (params) => {
    const msg = (params?.msg as string) ?? ''
    const n = (params?.n as number) ?? 1
    return msg.repeat(n)
  },
}

beforeEach(() => {
  setActivePinia(createPinia())
  _clearCapabilitiesForTest()
  registerCapability(mockTimeNow)
  registerCapability(mockEcho)
})

afterEach(() => {
  _clearCapabilitiesForTest()
})

describe('isSlashCommand', () => {
  it('detects leading slash', () => {
    expect(isSlashCommand('/foo')).toBe(true)
    expect(isSlashCommand('/')).toBe(true)
    expect(isSlashCommand('hello')).toBe(false)
    expect(isSlashCommand(' /foo')).toBe(false)
  })
})

describe('parseSlashCommand', () => {
  it('parses bare command', () => {
    expect(parseSlashCommand('/time.now')).toEqual({
      id: 'time.now',
      params: {},
    })
  })

  it('parses key=value args with type coercion', () => {
    const r = parseSlashCommand('/notes.timeline type=local limit=5')
    expect(r).toEqual({
      id: 'notes.timeline',
      params: { type: 'local', limit: 5 },
    })
  })

  it('parses quoted string values', () => {
    const r = parseSlashCommand('/notes.search query="hello world" limit=3')
    expect(r).toEqual({
      id: 'notes.search',
      params: { query: 'hello world', limit: 3 },
    })
  })

  it('coerces booleans', () => {
    const r = parseSlashCommand('/x flag=true other=false')
    expect(r).toEqual({ id: 'x', params: { flag: true, other: false } })
  })

  it('keeps id-like strings as strings even if numeric-looking', () => {
    // 先頭 0 / 英字混じりは文字列のまま
    const r = parseSlashCommand('/notes.user userId=9abc123')
    expect(r?.params.userId).toBe('9abc123')
  })

  it('returns empty id for bare slash (= help)', () => {
    expect(parseSlashCommand('/')).toEqual({ id: '', params: {} })
  })

  it('returns null on syntax errors', () => {
    expect(parseSlashCommand('/cmd badtoken')).toBeNull()
    expect(parseSlashCommand('/cmd =noKey')).toBeNull()
    expect(parseSlashCommand('/cmd unterminated="oops')).toBeNull()
  })

  it('returns null when input does not start with slash', () => {
    expect(parseSlashCommand('cmd')).toBeNull()
  })
})

describe('runSlashCommand', () => {
  it('runs help on bare /', async () => {
    const r = await runSlashCommand('/', configWithPreset('readonly'))
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'help') {
      expect(r.result).toContain('利用可能な')
      expect(r.result).toContain('/time.now')
    } else {
      throw new Error('expected help result')
    }
  })

  it('runs help on /help', async () => {
    const r = await runSlashCommand('/help', configWithPreset('readonly'))
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('help')
  })

  it('executes a registered capability', async () => {
    const r = await runSlashCommand('/time.now', configWithPreset('readonly'))
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'capability') {
      expect(r.result).toBe('2026-05-01T00:00:00Z')
      expect(r.displayName).toBe('/time.now')
    }
  })

  it('passes parsed params to capability', async () => {
    // echo.say は notes.write が要るので full preset
    const r = await runSlashCommand(
      '/echo.say msg=hi n=3',
      configWithPreset('full'),
    )
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'capability') {
      expect(r.result).toBe('hihihi')
      expect(r.params).toEqual({ msg: 'hi', n: 3 })
    }
  })

  it('returns parse_error for invalid syntax', async () => {
    const r = await runSlashCommand(
      '/cmd badtoken',
      configWithPreset('readonly'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('parse_error')
  })

  it('returns unknown_capability for unregistered ids', async () => {
    const r = await runSlashCommand('/no.such', configWithPreset('readonly'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('unknown_capability')
  })

  it('returns permission_denied when preset blocks the cap', async () => {
    // echo.say は notes.write を要求 → readonly では deny
    const r = await runSlashCommand(
      '/echo.say msg=x',
      configWithPreset('readonly'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('permission_denied')
  })
})

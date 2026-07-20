import { describe, expect, it } from 'vitest'
import {
  createAdapter,
  getRegisteredSoftware,
  resolveSoftware,
} from '@/adapters/registry'
import type { ServerInfo } from '@/adapters/types'

function createMockServerInfo(
  software: ServerInfo['software'] = 'misskey-dev/misskey',
): ServerInfo {
  return {
    host: 'example.com',
    software,
    version: '2025.1.0',
    features: {
      mastodonApi: false,
      reactions: true,
      customEmoji: true,
      drive: true,
      channels: true,
      antennas: true,
      quotes: true,
    },
  }
}

describe('adapter registry', () => {
  it('creates a misskey adapter', () => {
    const adapter = createAdapter(createMockServerInfo(), 'account-1')
    expect(adapter).toBeDefined()
    expect(adapter.serverInfo.software).toBe('misskey-dev/misskey')
  })

  it('falls back to misskey adapter for unknown software', () => {
    const adapter = createAdapter(createMockServerInfo('unknown'), 'account-1')
    expect(adapter).toBeDefined()
  })

  it('lists registered software', () => {
    const registered = getRegisteredSoftware()
    expect(registered).toContain('misskey-dev/misskey')
  })
})

describe('resolveSoftware', () => {
  it('resolves the official repository URL to misskey-dev/misskey', () => {
    expect(
      resolveSoftware('misskey', 'https://github.com/misskey-dev/misskey'),
    ).toBe('misskey-dev/misskey')
  })

  it('resolves known forks by repository URL', () => {
    expect(
      resolveSoftware('misskey', 'https://github.com/yamisskey-dev/yamisskey'),
    ).toBe('yamisskey-dev/yamisskey')
  })

  it('falls back to software name when repository is missing', () => {
    expect(resolveSoftware('misskey')).toBe('misskey-dev/misskey')
    expect(resolveSoftware('yamisskey')).toBe('yamisskey-dev/yamisskey')
  })

  it('returns unknown for non-misskey software', () => {
    expect(resolveSoftware('mastodon')).toBe('unknown')
  })
})

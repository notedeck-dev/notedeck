import { describe, expect, it } from 'vitest'
import {
  createAdapter,
  getRegisteredSoftware,
  isSupportedSoftware,
  resolveSoftware,
  softwareDisplayName,
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

  it('identifies the misskey.io fork by repository URL', () => {
    // software.name は "misskey" のままなので repository でしか分からない
    expect(
      resolveSoftware('misskey', 'https://github.com/MisskeyIO/misskey'),
    ).toBe('misskeyio/misskey')
  })

  it('identifies はなみすきー by repository URL (#916)', () => {
    // nodeinfo 2.1 の software.name は "misskey" のままで repository だけが違う
    expect(
      resolveSoftware('misskey', 'https://github.com/hanamisskey/misskey'),
    ).toBe('hanamisskey/misskey')
  })

  it('identifies known but unsupported forks by software name (#853)', () => {
    expect(resolveSoftware('sharkey')).toBe('sharkey/sharkey')
    expect(resolveSoftware('cherrypick')).toBe('kokonect-link/cherrypick')
    expect(resolveSoftware('iceshrimp')).toBe('iceshrimp/iceshrimp')
    expect(resolveSoftware('iceshrimp.net')).toBe('iceshrimp/iceshrimp')
  })

  it('identifies unsupported forks by repository URL', () => {
    expect(
      resolveSoftware(
        'cherrypick',
        'https://github.com/kokonect-link/cherrypick',
      ),
    ).toBe('kokonect-link/cherrypick')
  })
})

describe('isSupportedSoftware', () => {
  it('accepts misskey and forks that keep the misskey name', () => {
    expect(isSupportedSoftware('misskey-dev/misskey')).toBe(true)
    expect(isSupportedSoftware('yamisskey-dev/yamisskey')).toBe(true)
    expect(isSupportedSoftware('lqvp/misskey-tempura')).toBe(true)
    expect(isSupportedSoftware('misskeyio/misskey')).toBe(true)
    expect(isSupportedSoftware('hanamisskey/misskey')).toBe(true)
  })

  it('rejects identified but unsupported forks and unknown software', () => {
    expect(isSupportedSoftware('sharkey/sharkey')).toBe(false)
    expect(isSupportedSoftware('kokonect-link/cherrypick')).toBe(false)
    expect(isSupportedSoftware('iceshrimp/iceshrimp')).toBe(false)
    expect(isSupportedSoftware('unknown')).toBe(false)
  })
})

describe('softwareDisplayName', () => {
  it('returns the display name of identified software', () => {
    expect(softwareDisplayName('sharkey/sharkey')).toBe('Sharkey')
    expect(softwareDisplayName('misskey-dev/misskey')).toBe('Misskey')
  })

  it('returns null for unidentified software', () => {
    expect(softwareDisplayName('unknown')).toBe(null)
  })
})

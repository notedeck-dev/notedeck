import { describe, expect, it } from 'vitest'
import { formatMuteExpiry } from '@/utils/formatTime'
import {
  parseMuteExpiresAt,
  USER_BUILTIN_CAPABILITIES,
  userLookupCapability,
  userSearchCapability,
} from './user'

describe('user.lookup capability', () => {
  it('declares account.read permission and aiTool: true', () => {
    expect(userLookupCapability.permissions).toEqual(['account.read'])
    expect(userLookupCapability.aiTool).toBe(true)
    expect(userLookupCapability.id).toBe('user.lookup')
    expect(userLookupCapability.signature?.returns?.type).toBe('object')
  })

  it('accepts either username (+ host) or userId, so all are optional', () => {
    const params = userLookupCapability.signature?.params
    expect(params?.username?.optional).toBe(true)
    expect(params?.userId?.optional).toBe(true)
    expect(params?.host?.optional).toBe(true)
  })
})

describe('user.search capability', () => {
  it('declares account.read permission, aiTool, cheap, array return', () => {
    expect(userSearchCapability.id).toBe('user.search')
    expect(userSearchCapability.permissions).toEqual(['account.read'])
    expect(userSearchCapability.aiTool).toBe(true)
    expect(userSearchCapability.signature?.cheap).toBe(true)
    expect(userSearchCapability.signature?.returns?.type).toBe('array')
  })

  it('marks query as required and limit/accountId as optional', () => {
    const params = userSearchCapability.signature?.params
    expect(params?.query?.optional).not.toBe(true)
    expect(params?.limit?.optional).toBe(true)
    expect(params?.accountId?.optional).toBe(true)
  })
})

describe('user.mute / unmute / renoteMute / unrenoteMute', () => {
  it.each([
    'user.mute',
    'user.unmute',
    'user.renoteMute',
    'user.unrenoteMute',
  ] as const)('%s declares account.write + confirmation', (id) => {
    const cap = USER_BUILTIN_CAPABILITIES.find((c) => c.id === id)
    if (!cap) throw new Error(`${id} not found`)
    expect(cap.permissions).toEqual(['account.write'])
    expect(typeof cap.requiresConfirmation).toBe('function')
    expect(cap.aiTool).toBe(true)
    expect(cap.signature?.params?.userId?.optional).not.toBe(true)
  })

  it('mute capabilities throw when userId is missing', async () => {
    for (const id of [
      'user.mute',
      'user.unmute',
      'user.renoteMute',
      'user.unrenoteMute',
    ]) {
      const cap = USER_BUILTIN_CAPABILITIES.find((c) => c.id === id)
      if (!cap) throw new Error(`${id} not found`)
      await expect(cap.execute({})).rejects.toThrow(/userId is required/)
    }
  })
})

describe('user.follow / unfollow', () => {
  it.each([
    'user.follow',
    'user.unfollow',
  ] as const)('%s declares account.write + warning confirmation', (id) => {
    const cap = USER_BUILTIN_CAPABILITIES.find((c) => c.id === id)
    if (!cap) throw new Error(`${id} not found`)
    expect(cap.permissions).toEqual(['account.write'])
    expect(typeof cap.requiresConfirmation).toBe('function')
    expect(cap.aiTool).toBe(true)
    expect(cap.signature?.params?.userId?.optional).not.toBe(true)
  })
})

describe('user.followers / user.following', () => {
  it.each([
    'user.followers',
    'user.following',
  ] as const)('%s declares account.read + cheap + requires userId', (id) => {
    const cap = USER_BUILTIN_CAPABILITIES.find((c) => c.id === id)
    if (!cap) throw new Error(`${id} not found`)
    expect(cap.permissions).toEqual(['account.read'])
    expect(cap.aiTool).toBe(true)
    expect(cap.signature?.cheap).toBe(true)
    expect(cap.signature?.params?.userId?.optional).not.toBe(true)
    expect(cap.signature?.params?.limit?.optional).toBe(true)
  })
})

describe('USER_BUILTIN_CAPABILITIES', () => {
  it('contains lookup / search + 4 mute + 2 follow + 2 follow-list capabilities', () => {
    const ids = USER_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'user.follow',
      'user.followers',
      'user.following',
      'user.lookup',
      'user.mute',
      'user.renoteMute',
      'user.search',
      'user.unfollow',
      'user.unmute',
      'user.unrenoteMute',
    ])
  })
})

describe('user.mute の expiresAt', () => {
  it('省略・null・空文字は無期限 (undefined)', () => {
    expect(parseMuteExpiresAt(undefined)).toBeUndefined()
    expect(parseMuteExpiresAt(null)).toBeUndefined()
    expect(parseMuteExpiresAt('')).toBeUndefined()
  })

  it('ISO 8601 と UNIX ms を UNIX ms に揃える', () => {
    const future = Date.now() + 86_400_000
    expect(parseMuteExpiresAt(future)).toBe(future)
    const iso = new Date(future).toISOString()
    expect(parseMuteExpiresAt(iso)).toBe(Date.parse(iso))
  })

  it('読めない値と過去の時刻は拒否する', () => {
    expect(() => parseMuteExpiresAt('tomorrow')).toThrow(/ISO 8601/)
    expect(() => parseMuteExpiresAt(Date.now() - 1000)).toThrow(/future/)
  })
})

describe('user.mute の確認文言 (#1260)', () => {
  async function confirmMessage(
    params: Record<string, unknown>,
  ): Promise<string> {
    const cap = USER_BUILTIN_CAPABILITIES.find((c) => c.id === 'user.mute')
    if (!cap || typeof cap.requiresConfirmation !== 'function') {
      throw new Error('user.mute confirmation not found')
    }
    const opts = await cap.requiresConfirmation(
      params,
      {} as Parameters<typeof cap.requiresConfirmation>[1],
    )
    if (!opts) throw new Error('user.mute confirmation returned null')
    return opts.message
  }

  it('期限つきなら確認に「〜まで」を出す', async () => {
    const future = Date.now() + 86_400_000
    const msg = await confirmMessage({ userId: 'u1', expiresAt: future })
    expect(msg).toContain(formatMuteExpiry(future))
    expect(msg).toContain('まで')
  })

  it('無期限なら期限を出さない', async () => {
    expect(await confirmMessage({ userId: 'u1' })).not.toContain('まで')
  })
})

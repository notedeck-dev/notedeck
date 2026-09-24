import { describe, expect, it } from 'vitest'
import {
  CHANNEL_BUILTIN_CAPABILITIES,
  channelListCapability,
  channelNotesCapability,
} from './channel'

describe('channel capabilities — declaration', () => {
  it('channel.list: account.read, cheap, aiTool', () => {
    expect(channelListCapability.id).toBe('channel.list')
    expect(channelListCapability.permissions).toEqual(['account.read'])
    expect(channelListCapability.signature?.cheap).toBe(true)
    expect(channelListCapability.signature?.returns?.type).toBe('array')
    expect(channelListCapability.aiTool).toBe(true)
  })

  it('channel.notes: notes.read, requires channelId', () => {
    expect(channelNotesCapability.id).toBe('channel.notes')
    expect(channelNotesCapability.permissions).toEqual(['notes.read'])
    expect(channelNotesCapability.aiTool).toBe(true)
    expect(
      channelNotesCapability.signature?.params?.channelId?.optional,
    ).not.toBe(true)
    expect(channelNotesCapability.signature?.params?.limit?.optional).toBe(true)
  })
})

describe('CHANNEL_BUILTIN_CAPABILITIES', () => {
  it('contains list / notes', () => {
    const ids = CHANNEL_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['channel.list', 'channel.notes'])
  })
})

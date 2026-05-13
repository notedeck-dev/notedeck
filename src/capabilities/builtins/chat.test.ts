import { describe, expect, it } from 'vitest'
import {
  CHAT_BUILTIN_CAPABILITIES,
  chatReactCapability,
  chatUnreactCapability,
} from './chat'

describe('chat reaction capabilities — declaration', () => {
  it.each([
    ['chat.react', chatReactCapability] as const,
    ['chat.unreact', chatUnreactCapability] as const,
  ])('%s declares notes.react permission + confirmation', (id, cap) => {
    expect(cap.id).toBe(id)
    expect(cap.permissions).toEqual(['notes.react'])
    expect(cap.requiresConfirmation).toBe(true)
    expect(cap.aiTool).toBe(true)
    expect(cap.signature?.params?.messageId?.optional).not.toBe(true)
    expect(cap.signature?.params?.reaction?.optional).not.toBe(true)
  })

  it('throw when messageId/reaction missing', async () => {
    await expect(chatReactCapability.execute({})).rejects.toThrow(
      /messageId is required/,
    )
    await expect(
      chatReactCapability.execute({ messageId: 'm1' }),
    ).rejects.toThrow(/reaction is required/)
    await expect(chatUnreactCapability.execute({})).rejects.toThrow(
      /messageId is required/,
    )
    await expect(
      chatUnreactCapability.execute({ messageId: 'm1' }),
    ).rejects.toThrow(/reaction is required/)
  })
})

describe('CHAT_BUILTIN_CAPABILITIES', () => {
  it('contains react / unreact', () => {
    const ids = CHAT_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['chat.react', 'chat.unreact'])
  })
})

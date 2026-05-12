import { describe, expect, it, vi } from 'vitest'

// `useAiChat` の `sendAiChatOnce` をモックして実 Tauri invoke を回避する。
vi.mock('@/composables/useAiChat', () => ({
  sendAiChatOnce: vi.fn(async (opts: { history: { content: string }[] }) => {
    return `mocked response to: ${opts.history[0]?.content ?? ''}`
  }),
}))

import { sendAiChatOnce } from '@/composables/useAiChat'
import type { AiConfig } from '@/composables/useAiConfig'
import { defaultConfig } from '@/composables/useAiConfig'
import { AI_BUILTIN_CAPABILITIES, aiChatCapability } from './ai'

function makeAiConfig(): AiConfig {
  return defaultConfig()
}

describe('ai.chat capability', () => {
  it('declares ai.invoke permission and aiTool: false (= AI 本体は呼べない)', () => {
    expect(aiChatCapability.permissions).toEqual(['ai.invoke'])
    expect(aiChatCapability.aiTool).toBe(false)
  })

  it('uses dot-notation id', () => {
    expect(aiChatCapability.id).toBe('ai.chat')
  })

  it('is visible (= コマンドパレットから手動で叩ける)', () => {
    expect(aiChatCapability.visible).toBe(true)
  })

  it('does NOT require per-call confirmation (permission gate で十分)', () => {
    expect(aiChatCapability.requiresConfirmation).toBe(false)
  })

  it('marks prompt as required and other params as optional', () => {
    const params = aiChatCapability.signature?.params
    expect(params?.prompt?.optional).not.toBe(true)
    expect(params?.system?.optional).toBe(true)
    expect(params?.model?.optional).toBe(true)
    expect(params?.maxTokens?.optional).toBe(true)
  })

  it('rejects empty prompt before calling AI', async () => {
    await expect(
      aiChatCapability.execute({ prompt: '' }, { aiConfig: makeAiConfig() }),
    ).rejects.toThrow(/prompt is required/)
    await expect(
      aiChatCapability.execute({}, { aiConfig: makeAiConfig() }),
    ).rejects.toThrow(/prompt is required/)
  })

  it('throws when called without ctx.aiConfig', async () => {
    await expect(aiChatCapability.execute({ prompt: 'hello' })).rejects.toThrow(
      /AiConfig/,
    )
  })

  it('returns { response } from sendAiChatOnce', async () => {
    const result = (await aiChatCapability.execute(
      { prompt: 'hello' },
      { aiConfig: makeAiConfig() },
    )) as { response: string }
    expect(result.response).toBe('mocked response to: hello')
  })

  it('forwards model override when given', async () => {
    const mock = vi.mocked(sendAiChatOnce)
    mock.mockClear()
    await aiChatCapability.execute(
      { prompt: 'q', model: 'custom-model-x' },
      { aiConfig: makeAiConfig() },
    )
    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'custom-model-x' }),
    )
  })

  it('falls back to provider default model when model param is missing', async () => {
    const mock = vi.mocked(sendAiChatOnce)
    mock.mockClear()
    const cfg = makeAiConfig()
    await aiChatCapability.execute({ prompt: 'q' }, { aiConfig: cfg })
    const expectedModel = cfg.anthropic.model // provider default = anthropic
    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({ model: expectedModel }),
    )
  })
})

describe('AI_BUILTIN_CAPABILITIES', () => {
  it('contains ai.chat', () => {
    expect(AI_BUILTIN_CAPABILITIES).toContain(aiChatCapability)
  })
})

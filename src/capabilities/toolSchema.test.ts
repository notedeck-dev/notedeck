import { describe, expect, it } from 'vitest'
import type { Capability } from '@/capabilities/types'
import { toAnthropicTool, toOpenAiTool } from './toolSchema'

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'notes.post',
    label: 'ノートを投稿',
    icon: 'ti-pencil',
    category: 'note',
    aiTool: true,
    permissions: ['notes.write'],
    signature: {
      description: 'Post a note to the current account',
      params: {
        text: { type: 'string', description: 'Note body' },
        visibility: {
          type: 'string',
          description: 'Visibility level',
          enum: ['public', 'home', 'followers', 'specified'],
          optional: true,
        },
      },
      returns: { type: 'object', description: 'Created note' },
    },
    execute: () => undefined,
    ...overrides,
  }
}

describe('toAnthropicTool', () => {
  it('builds a flat Anthropic tool definition', () => {
    const tool = toAnthropicTool(makeCapability())
    // Anthropic の tool name 制約 (^[a-zA-Z0-9_-]{1,128}$) に合わせて
    // dotted id (`notes.post`) は sanitize される (`.` → `_`)
    expect(tool.name).toBe('notes_post')
    expect(tool.description).toBe('Post a note to the current account')
    expect(tool.input_schema.type).toBe('object')
  })

  it('marks required params (= optional !== true)', () => {
    const tool = toAnthropicTool(makeCapability())
    expect(tool.input_schema.required).toEqual(['text'])
    expect(tool.input_schema.properties.text?.type).toBe('string')
    expect(tool.input_schema.properties.visibility?.type).toBe('string')
  })

  it('forwards enum values for restricted params', () => {
    const tool = toAnthropicTool(makeCapability())
    expect(tool.input_schema.properties.visibility?.enum).toEqual([
      'public',
      'home',
      'followers',
      'specified',
    ])
  })

  it('omits required when no params are required', () => {
    const tool = toAnthropicTool(
      makeCapability({
        signature: {
          description: 'no-arg',
          params: {
            verbose: {
              type: 'boolean',
              description: '',
              optional: true,
            },
          },
        },
      }),
    )
    expect(tool.input_schema.required).toBeUndefined()
  })

  it('handles empty params', () => {
    const tool = toAnthropicTool(
      makeCapability({
        signature: { description: 'no params', params: {} },
      }),
    )
    expect(tool.input_schema.properties).toEqual({})
    expect(tool.input_schema.required).toBeUndefined()
  })

  it('throws when capability has no signature', () => {
    expect(() =>
      toAnthropicTool(makeCapability({ signature: undefined })),
    ).toThrow(/signature/)
  })
})

describe('toOpenAiTool', () => {
  it('wraps the capability in the OpenAI function-call envelope', () => {
    const tool = toOpenAiTool(makeCapability())
    expect(tool.type).toBe('function')
    // OpenAI の function name 制約 (^[a-zA-Z0-9_-]{1,64}$) に合わせて
    // dotted id (`notes.post`) は sanitize される (`.` → `_`)
    expect(tool.function.name).toBe('notes_post')
    expect(tool.function.description).toBe('Post a note to the current account')
    expect(tool.function.parameters.type).toBe('object')
    expect(tool.function.parameters.required).toEqual(['text'])
  })

  it('throws when capability has no signature', () => {
    expect(() =>
      toOpenAiTool(makeCapability({ signature: undefined })),
    ).toThrow(/signature/)
  })
})

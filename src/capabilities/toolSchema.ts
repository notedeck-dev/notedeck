/**
 * Capability → tool schema 変換器。
 *
 * Phase 2 A-3.1 では Anthropic / OpenAI の 2 形式に対応する。
 * Custom (OpenAI 互換: OpenRouter / Groq 等) は OpenAI 形式を流用。
 *
 * Refs:
 *   Anthropic: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 *   OpenAI:    https://platform.openai.com/docs/guides/function-calling
 */

import type { Capability } from '@/capabilities/types'
import { sanitizeToolName } from './identifier'
import type { CapabilitySignature, ParameterDef } from './types'

interface ParamSchema {
  type: string
  description: string
  enum?: readonly string[]
}

interface InputSchema {
  type: 'object'
  properties: Record<string, ParamSchema>
  required?: string[]
}

// --- Anthropic ---

export interface AnthropicTool {
  name: string
  description: string
  input_schema: InputSchema
}

export function toAnthropicTool(cmd: Capability): AnthropicTool {
  if (!cmd.signature) {
    throw new Error(`Capability "${cmd.id}" has no signature`)
  }
  return {
    name: sanitizeToolName(cmd.id),
    description: cmd.signature.description,
    input_schema: paramsToInputSchema(cmd.signature.params),
  }
}

// --- OpenAI Chat Completions ---

export interface OpenAiTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: InputSchema
  }
}

export function toOpenAiTool(cmd: Capability): OpenAiTool {
  if (!cmd.signature) {
    throw new Error(`Capability "${cmd.id}" has no signature`)
  }
  return {
    type: 'function',
    function: {
      name: sanitizeToolName(cmd.id),
      description: cmd.signature.description,
      parameters: paramsToInputSchema(cmd.signature.params),
    },
  }
}

// --- Helpers ---

function paramsToInputSchema(
  params: CapabilitySignature['params'],
): InputSchema {
  const properties: Record<string, ParamSchema> = {}
  const required: string[] = []
  for (const [key, def] of Object.entries(params ?? {})) {
    properties[key] = paramToSchema(def)
    if (!def.optional) required.push(key)
  }
  const schema: InputSchema = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}

function paramToSchema(def: ParameterDef): ParamSchema {
  const out: ParamSchema = {
    type: def.type,
    description: def.description,
  }
  if (def.enum) out.enum = def.enum
  return out
}

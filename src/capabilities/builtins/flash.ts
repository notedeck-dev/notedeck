import type { FlashesEndpoint } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

/**
 * Flash (Misskey Play) 系 capability。Misskey の AiScript 小アプリ。
 *
 * read-only。flash.show は **AiScript ソース** を含むため、AI が既存 Play を
 * 学習素材として読んで再利用 / 改変 / 自前 widget へ移植する動線が成立する。
 *
 * permission: `account.read`。like / unlike / update は副作用ありで除外。
 */

const VALID_FLASH_ENDPOINTS: readonly FlashesEndpoint[] = [
  'flash/featured',
  'flash/my',
  'flash/my-likes',
] as const

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

export const flashListCapability = implement('flash.list', {
  execute: async (params, ctx) => {
    const endpoint = pickString(params?.endpoint)
    if (!endpoint) throw new Error('flash.list: endpoint is required')
    if (!(VALID_FLASH_ENDPOINTS as readonly string[]).includes(endpoint)) {
      throw new Error(
        `flash.list: invalid endpoint "${endpoint}". Valid: ${VALID_FLASH_ENDPOINTS.join(', ')}`,
      )
    }
    const limit = pickNumber(params?.limit)
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getFlashes(endpoint as FlashesEndpoint, limit)
  },
})

export const flashShowCapability = implement('flash.show', {
  execute: async (params, ctx) => {
    const flashId = pickString(params?.flashId)
    if (!flashId) throw new Error('flash.show: flashId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getFlash(flashId)
  },
})

export const FLASH_BUILTIN_CAPABILITIES: readonly Command[] = [
  flashListCapability,
  flashShowCapability,
]

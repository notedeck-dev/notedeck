import type { PagesEndpoint } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

/**
 * Pages (Misskey Pages) 系 capability。Misskey の長文記事 / wiki 機能。
 *
 * read-only のみ提供。like / unlike は副作用ありで本 PR では除外する
 * (Misskey 本家でも「いいね」相当は記事作者へ通知が飛ぶ)。
 *
 * permission: `account.read`。情報源として AI に開放することで、ユーザーが
 * 書いた wiki / 自分が like した記事を AI が引用 / 要約 / 検索できる。
 */

const VALID_PAGES_ENDPOINTS: readonly PagesEndpoint[] = [
  'pages/featured',
  'i/pages',
  'i/page-likes',
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

export const pagesListCapability = implement('pages.list', {
  execute: async (params, ctx) => {
    const endpoint = pickString(params?.endpoint)
    if (!endpoint) throw new Error('pages.list: endpoint is required')
    if (!(VALID_PAGES_ENDPOINTS as readonly string[]).includes(endpoint)) {
      throw new Error(
        `pages.list: invalid endpoint "${endpoint}". Valid: ${VALID_PAGES_ENDPOINTS.join(', ')}`,
      )
    }
    const limit = pickNumber(params?.limit)
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getPages(endpoint as PagesEndpoint, limit)
  },
})

export const pagesShowCapability = implement('pages.show', {
  execute: async (params, ctx) => {
    const pageId = pickString(params?.pageId)
    if (!pageId) throw new Error('pages.show: pageId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getPage(pageId)
  },
})

export const PAGES_BUILTIN_CAPABILITIES: readonly Command[] = [
  pagesListCapability,
  pagesShowCapability,
]

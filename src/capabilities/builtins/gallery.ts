import type { Command } from '@/commands/registry'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

/**
 * Gallery (Misskey Gallery) 系 capability。Misskey の写真ギャラリー機能。
 *
 * read-only のみ提供。like / unlike は副作用ありで本 PR では除外する。
 * permission: `account.read`。AI から最近の gallery 投稿を引用 / 要約できる。
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

export const galleryListCapability = implement('gallery.list', {
  execute: async (params, ctx) => {
    const limit = pickNumber(params?.limit)
    const untilId = pickString(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getGalleryPosts({ limit, untilId })
  },
})

export const GALLERY_BUILTIN_CAPABILITIES: readonly Command[] = [
  galleryListCapability,
]

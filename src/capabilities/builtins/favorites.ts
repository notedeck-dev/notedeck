import type { Command } from '@/commands/registry'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

/**
 * Favorites — Misskey の「お気に入り」(自分だけが見える private bookmark)。
 * 他人に通知は飛ばず、自分しか見えないので軽い。`notes.react` permission を
 * 再利用 (= リアクションと同レベル、ただし react の方が公開度が高い)。
 *
 * 確認 UI は標準 (danger だが内容は軽い、可逆)。
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

export const favoritesAddCapability = implement('favorites.add', {
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('favorites.add: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.createFavorite(noteId)
    return { favorited: true, noteId }
  },
})

export const favoritesRemoveCapability = implement('favorites.remove', {
  execute: async (params, ctx) => {
    const noteId = pickString(params?.noteId)
    if (!noteId) throw new Error('favorites.remove: noteId is required')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.deleteFavorite(noteId)
    return { unfavorited: true, noteId }
  },
})

export const FAVORITES_BUILTIN_CAPABILITIES: readonly Command[] = [
  favoritesAddCapability,
  favoritesRemoveCapability,
]

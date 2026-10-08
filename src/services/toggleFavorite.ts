import type { NormalizedNote } from '@/adapters/types'

interface FavoriteApi {
  createFavorite(noteId: string): Promise<void>
  deleteFavorite(noteId: string): Promise<void>
}

export async function toggleFavorite(
  api: FavoriteApi,
  note: NormalizedNote,
  onMutated?: () => void,
): Promise<void> {
  const prev = note.isFavorited

  try {
    note.isFavorited = !prev
    onMutated?.()
    if (prev) {
      await api.deleteFavorite(note.id)
    } else {
      await api.createFavorite(note.id)
    }
  } catch (e) {
    note.isFavorited = prev
    onMutated?.()
    throw e
  }
}

import type { DeckWindow } from '@/stores/windows'

const builders: Partial<
  Record<DeckWindow['type'], (win: DeckWindow, host: string) => string | null>
> = {
  'note-detail': (w, h) =>
    typeof w.props.noteId === 'string'
      ? `notedeck://${h}/note/${w.props.noteId}`
      : null,
  'note-inspector': (w, h) =>
    typeof w.props.noteId === 'string'
      ? `notedeck://${h}/note/${w.props.noteId}`
      : null,
  'user-profile': (w, h) =>
    typeof w.props.userId === 'string'
      ? `notedeck://${h}/user/${w.props.userId}`
      : null,
  'follow-list': (w, h) => {
    const uid = w.props.userId
    if (typeof uid !== 'string') return null
    const tab = w.props.initialTab === 'followers' ? 'followers' : 'following'
    return `notedeck://${h}/user/${uid}/${tab}`
  },
  'federation-instance': (w, h) =>
    typeof w.props.host === 'string'
      ? `notedeck://${h}/instance/${w.props.host}`
      : null,
  'page-detail': (w, h) =>
    typeof w.props.pageId === 'string'
      ? `notedeck://${h}/page/${w.props.pageId}`
      : null,
  'play-detail': (w, h) =>
    typeof w.props.flashId === 'string'
      ? `notedeck://${h}/play/${w.props.flashId}`
      : null,
  'gallery-detail': (w, h) =>
    typeof w.props.postId === 'string'
      ? `notedeck://${h}/gallery/${w.props.postId}`
      : null,
  'clip-detail': (w, h) =>
    typeof w.props.clipId === 'string'
      ? `notedeck://${h}/clip/${w.props.clipId}`
      : null,
  'list-detail': (w, h) =>
    typeof w.props.listId === 'string'
      ? `notedeck://${h}/list/${w.props.listId}`
      : null,
}

/**
 * Build a notedeck:// URI for the given window.
 * Returns null when the window type has no URI mapping, the account host is
 * unknown, or required props are missing.
 */
export function buildWindowUri(
  win: DeckWindow,
  accountHost: string | null,
): string | null {
  if (!accountHost) return null
  return builders[win.type]?.(win, accountHost) ?? null
}

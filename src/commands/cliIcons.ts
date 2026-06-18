/** Command name → Tabler icon mapping. Fallback: 'terminal' */
export const CLI_ICONS: Record<string, string> = {
  post: 'send',
  search: 'search',
  timeline: 'list',
  notifications: 'bell',
  mentions: 'at',
  note: 'note',
  replies: 'message-2',
  thread: 'messages',
  delete: 'trash',
  update: 'pencil',
  react: 'mood-happy',
  unreact: 'mood-x-mark',
  renote: 'repeat',
  user: 'user',
  'user-notes': 'news',
  follow: 'user-plus',
  unfollow: 'user-minus',
  favorite: 'star',
  unfavorite: 'star-off',
  favorites: 'stars',
  emojis: 'mood-smile',
  accounts: 'users',
}

export function getCliIcon(name: string): string {
  return CLI_ICONS[name] ?? 'terminal'
}

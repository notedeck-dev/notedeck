import type { DeckColumn } from '@/stores/deck'

const localUriBuilders: Partial<
  Record<DeckColumn['type'], (col: DeckColumn) => string>
> = {
  widget: (col) => `notedeck://widget/${col.id}`,
  aiscript: (col) => `notedeck://aiscript/${col.id}`,
  play: (col) => `notedeck://play/${col.id}`,
  apiDocs: () => 'notedeck://api/docs',
  lookup: (col) => `notedeck://lookup/${col.id}`,
  serverInfo: (col) => `notedeck://server-info/${col.id}`,
}

const accountUriBuilders: Partial<
  Record<DeckColumn['type'], (col: DeckColumn, host: string) => string>
> = {
  timeline: (col, host) => `notedeck://${host}/timeline/${col.tl ?? 'home'}`,
  notifications: (_, host) => `notedeck://${host}/notifications`,
  search: (col, host) =>
    `notedeck://${host}/search${col.query ? `?q=${col.query}` : ''}`,
  list: (col, host) => `notedeck://${host}/list/${col.listId}`,
  antenna: (col, host) => `notedeck://${host}/antenna/${col.antennaId}`,
  favorites: (_, host) => `notedeck://${host}/favorites`,
  clip: (col, host) => `notedeck://${host}/clip/${col.clipId}`,
  channel: (col, host) => `notedeck://${host}/channel/${col.channelId}`,
  user: (col, host) => `notedeck://${host}/user/${col.userId}`,
  mentions: (_, host) => `notedeck://${host}/mentions`,
  specified: (_, host) => `notedeck://${host}/direct`,
  chat: (_, host) => `notedeck://${host}/chat`,
  announcements: (_, host) => `notedeck://${host}/announcements`,
  drive: (_, host) => `notedeck://${host}/drive`,
  gallery: (_, host) => `notedeck://${host}/gallery`,
}

/**
 * Build a notedeck:// URI for the given column.
 * Returns null when the column type has no URI mapping or the account is unknown.
 */
export function buildColumnUri(
  col: DeckColumn,
  accountHost: string | null,
): string | null {
  const localBuilder = localUriBuilders[col.type]
  if (localBuilder) return localBuilder(col)

  if (!accountHost) return null
  const accountBuilder = accountUriBuilders[col.type]
  return accountBuilder ? accountBuilder(col, accountHost) : null
}

export interface ParsedNoteUrl {
  host: string
  noteId: string
}

// Misskey: https://{host}/notes/{noteId}
const misskeyNoteRe = /^https?:\/\/([^/]+)\/notes\/([a-zA-Z0-9]+)$/

// Mastodon: https://{host}/@{user}/{id}
const mastodonNoteRe = /^https?:\/\/([^/]+)\/@[^/]+\/(\d+)$/

export function parseNoteUrl(url: string): ParsedNoteUrl | null {
  let m = misskeyNoteRe.exec(url)
  if (m?.[1] && m[2]) return { host: m[1], noteId: m[2] }

  m = mastodonNoteRe.exec(url)
  if (m?.[1] && m[2]) return { host: m[1], noteId: m[2] }

  return null
}

/**
 * TS 側で合成するローカルノート (下書きプレビュー・AI プレビュー) の identity。
 * サーバー由来のノートは Rust が `_identity` を付けるので、ここは使わない (#1058)。
 * 合成ノートは常に自アカウントのサーバーが origin なので正規形をそのまま組む。
 */
export function localNoteIdentity(serverHost: string, noteId: string): string {
  return `https://${serverHost.toLowerCase()}/notes/${noteId}`
}

/**
 * 人に見せる表示 URL を返す。リンクコピー・共有など
 * 「ブラウザで開ける URL が欲しい」文脈で使う（url 優先）。
 */
export function getNoteShareUrl(note: {
  id: string
  uri?: string | null
  url?: string | null
  _serverHost: string
}): string {
  return note.url ?? note.uri ?? `https://${note._serverHost}/notes/${note.id}`
}

export interface ParsedUserQuery {
  username: string
  host: string | null
}

/**
 * @user or @user@host 形式の文字列を解析する。
 * 照会カラムで使用。
 */
export function parseUserQuery(input: string): ParsedUserQuery | null {
  const raw = input.replace(/^@/, '')
  const parts = raw.split('@')
  if (
    parts[0] &&
    /^[a-zA-Z0-9_]+$/.test(parts[0]) &&
    (input.startsWith('@') || (parts.length === 2 && parts[1]))
  ) {
    return { username: parts[0], host: parts[1] || null }
  }
  return null
}

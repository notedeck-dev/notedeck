/**
 * ユーザーの参照 (acct) の分解と正規化 (#1185)。
 *
 * 照会カラムの入力と検索の投稿者条件が別々に `@` 表記を解いていたので、分解と
 * 正規化だけをここで共有する。「裸の語 (`@` も host も無い) をユーザー名と見なす
 * か」は呼び出し側の規則 (照会はノート ID、検索の投稿者はユーザー名)。
 */

export interface UserRef {
  username: string
  /** null = 各アカウントの自サーバー */
  host: string | null
}

const USERNAME_RE = /^[a-zA-Z0-9_]+$/
/** Misskey のプロフィール URL: `/@user` または `/@user@host` (本家が生成する形) */
const PROFILE_URL_RE = /^https?:\/\/([^/]+)\/@([^/@?#]+)(?:@([^/?#]+))?\/?$/

/**
 * `@user` / `user@host` / `@user@host` / プロフィール URL を acct に分解する。
 * 裸の語と、username に許されない文字を含むものは null
 */
export function parseUserRef(input: string): UserRef | null {
  const raw = input.trim()
  const url = PROFILE_URL_RE.exec(raw)
  if (url) {
    // biome-ignore lint/style/noNonNullAssertion: 正規表現の必須グループ
    const username = url[2]!
    if (!USERNAME_RE.test(username)) return null
    return { username, host: normalizeAcctHost(url[3] ?? url[1] ?? '') }
  }
  const body = raw.replace(/^@/, '')
  const parts = body.split('@')
  const username = parts[0]
  if (!username || !USERNAME_RE.test(username)) return null
  if (parts.length > 2) return null
  const host = parts[1]
  if (host !== undefined) {
    if (!host) return null
    return { username, host: normalizeAcctHost(host) }
  }
  return raw.startsWith('@') ? { username, host: null } : null
}

/**
 * 比較・束ね用の host (IDNA の ASCII 化 + 小文字)。サーバーが返す user.host は
 * punycode 小文字、アプリに保存したアカウントの host は小文字化のみなので、
 * 両方をここに通してから比べる。解釈できなければ小文字化だけ
 */
export function normalizeAcctHost(host: string): string {
  const h = host.trim()
  try {
    return new URL(`https://${h}/`).host
  } catch {
    return h.toLowerCase()
  }
}

/** 表示用の acct (`user@host`)。ローカルユーザーの host はそのアカウントのサーバーで補う */
export function acctOf(
  user: { username: string; host: string | null },
  accountHost: string,
): string {
  return `${user.username}@${user.host ?? accountHost}`
}

/**
 * `users/show` に渡す host。自サーバーの acct には null を渡す (host 文字列を
 * 渡すと、見つからないときの応答が「見つからない」でなく「解決できない」に包まれる)
 */
export function hostParamFor(ref: UserRef, accountHost: string): string | null {
  if (ref.host === null) return null
  return ref.host === normalizeAcctHost(accountHost) ? null : ref.host
}

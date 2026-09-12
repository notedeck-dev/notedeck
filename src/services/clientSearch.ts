/**
 * クライアント検索 (#945 / #958) の純ロジック。手元のキャッシュ (SQLite) を
 * サーバー・アカウント横断で引く。サーバー検索 (`search` 種別、Misskey の
 * notes/search) とは並立する別の面で、置き換えではない。
 */

export interface ClientSearchFilter {
  /**
   * 範囲: `''` = 全アカウント、`server:<host>` = そのサーバーの全アカウント、
   * `account:<id>` = そのアカウントだけ
   */
  scope?: string
  /** 投稿者 `name` または `name@host` */
  author?: string
  /** YYYY-MM-DD */
  since?: string
  until?: string
  /** undefined = 問わない */
  hasFiles?: boolean
  /** true = 古い順 */
  ascending?: boolean
}

export interface ScopeAccount {
  id: string
  host: string
}

/** 範囲指定から検索対象のアカウント ID 列を決める。該当なしは空配列 */
export function resolveScopeAccounts(
  scope: string | undefined,
  accounts: readonly ScopeAccount[],
): string[] {
  if (!scope) return accounts.map((a) => a.id)
  if (scope.startsWith('server:')) {
    const host = scope.slice('server:'.length).toLowerCase()
    return accounts
      .filter((a) => a.host.toLowerCase() === host)
      .map((a) => a.id)
  }
  if (scope.startsWith('account:')) {
    const id = scope.slice('account:'.length)
    return accounts.some((a) => a.id === id) ? [id] : []
  }
  return accounts.map((a) => a.id)
}

/** 日付入力 (YYYY-MM-DD) を created_at 比較用の ISO 境界にする */
export function dateBounds(filter: ClientSearchFilter): {
  since: string | null
  until: string | null
} {
  const since = filter.since
    ? new Date(`${filter.since}T00:00:00`).toISOString()
    : null
  const until = filter.until
    ? new Date(`${filter.until}T23:59:59.999`).toISOString()
    : null
  return { since, until }
}

/** 絞り込みが 1 つでも効いているか (フィルタボタンの強調に使う) */
export function hasActiveFilter(filter: ClientSearchFilter): boolean {
  return Boolean(
    filter.scope ||
      filter.author?.trim() ||
      filter.since ||
      filter.until ||
      filter.hasFiles !== undefined,
  )
}

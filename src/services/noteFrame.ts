import type { NormalizedUser, ServerInfo, UserInstance } from '@/adapters/types'

/**
 * ノート表示の「基準サーバー」(#1059)。
 *
 * Misskey の API は取得したサーバーのローカルユーザーを `host: null` で返し、
 * インスタンスティッカーもリモートユーザーにしか付けない。per-account 面では
 * 基準が 1 つなので自然だが、全アカウント面では行ごとに基準が変わり、
 * 「どのサーバーが特別扱いなのか分からない」見え方になる。全アカウント面では
 * 基準を絶対にし、取得元サーバー (`_serverHost`) を補って全員に出す。
 */

/** `@user@host`。相対表示ではローカルユーザーの host を出さない (本家と同じ) */
export function displayAcct(
  user: Pick<NormalizedUser, 'username' | 'host'>,
  serverHost: string,
  absolute: boolean,
): string {
  const host = user.host ?? (absolute ? serverHost : null)
  return host ? `@${user.username}@${host}` : `@${user.username}`
}

export interface TickerInfo {
  name: string
  iconUrl: string | null
  themeColor: string | null
}

/**
 * インスタンスティッカー。リモートユーザーは API 同梱の instance、絶対表示の
 * ローカルユーザーは取得元サーバーの検出情報から組む (名前は host で代用)
 */
export function tickerInfo(
  user: Pick<NormalizedUser, 'host' | 'instance'>,
  serverHost: string,
  absolute: boolean,
  lookupServer: (host: string) => ServerInfo | undefined,
): TickerInfo | null {
  const inst: UserInstance | undefined = user.instance
  if (inst) {
    return {
      name: inst.name || user.host || serverHost,
      iconUrl: inst.faviconUrl || inst.iconUrl || null,
      themeColor: inst.themeColor,
    }
  }
  if (!absolute || user.host) return null
  const server = lookupServer(serverHost)
  return {
    name: serverHost,
    iconUrl: server?.iconUrl ?? null,
    themeColor: server?.themeColor ?? null,
  }
}

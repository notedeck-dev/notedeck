import type { NormalizedUser, UserRelation } from '@/adapters/types'
import { AppError } from '@/utils/errors'
import { acctKeyOf, acctOf } from './userRef'

/**
 * 全アカウントのユーザー照会の結果の束ね (#1185)。アカウントごとに返る user は
 * サーバー内 ID が違うので acct で束ね、1 枚のカードの下にアカウントごとの行を置く。
 */

export interface UserLookupHit {
  accountId: string
  accountHost: string
  user: NormalizedUser
  /** そのアカウントから見た関係。取れなければ null */
  relation: UserRelation | null
}

export type UserLookupMissKind = 'notFound' | 'unresolved' | 'failed'

export interface UserLookupMiss {
  accountId: string
  accountHost: string
  kind: UserLookupMissKind
}

export interface UserLookupGroup {
  /** 束ねキー (username 小文字 + 正規化 host) */
  key: string
  /** 表示用の acct。最初に返った行のもの */
  acct: string
  /** カードに使う user。最初に返った行のもの */
  primary: UserLookupHit
  hits: UserLookupHit[]
}

/** 返った順を保ったまま acct で束ねる */
export function groupUserHits(
  hits: readonly UserLookupHit[],
): UserLookupGroup[] {
  const groups = new Map<string, UserLookupGroup>()
  for (const hit of hits) {
    const key = acctKeyOf(hit.user, hit.accountHost)
    const g = groups.get(key)
    if (g) g.hits.push(hit)
    else
      groups.set(key, {
        key,
        acct: acctOf(hit.user, hit.accountHost),
        primary: hit,
        hits: [hit],
      })
  }
  return [...groups.values()]
}

/**
 * `users/show` の失敗を 2 種 + その他に分ける。サーバーが区別するのはこの 2 つだけで、
 * WebFinger の失敗 / タイムアウト / 連合の拒否は全部「解決できない」に畳まれる
 */
export function classifyUserLookupError(e: unknown): UserLookupMissKind {
  const code = AppError.from(e).apiCode
  if (code === 'NO_SUCH_USER') return 'notFound'
  if (code === 'FAILED_TO_RESOLVE_REMOTE_USER') return 'unresolved'
  return 'failed'
}

import type { NormalizedUser, UserRelation } from '@/adapters/types'
import { AppError } from '@/utils/errors'

/**
 * 全アカウントのユーザー照会の結果 (#1185)。アカウントごとに返る user はサーバー内
 * ID が違うので、行はアカウント単位で持つ。
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

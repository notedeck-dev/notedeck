/**
 * カラムのアカウントスコープ (#1018)。
 *
 * `accountId === null` には意味の異なる 2 つの状態が同居していた。
 *
 * - **全アカウント** — ログイン中の全アカウントを束ねる (通知・検索・チャット等)
 * - **アカウントなし** — そもそもアカウントに紐づかない (AI・スキル・タスク等)
 *
 * 保存形式は `accountId: string | null` のままにして、意味は registry の宣言
 * (`crossAccount`) から引き直す。両者は種別ごとに排他なので復元は一意に決まり、
 * デッキの永続化フォーマットも移行も要らない。判定はこのファイル 1 本に集約する
 * — カラムを受け取る側が「束ねるべき」か「関係ない」かを各自で判定すると、
 * 対応種別が増えるたびに虫食いが再発するため。
 */

import type { DeckColumn } from '@/stores/deck'
import { CROSS_ACCOUNT_TYPES } from './registry'

export type AccountScope =
  /** 特定アカウントに紐づく */
  | 'account'
  /** ログイン中の全アカウントを束ねる */
  | 'all'
  /** アカウントに紐づかない */
  | 'none'

type ColumnLike = Pick<DeckColumn, 'type' | 'accountId'>

export function getAccountScope(column: ColumnLike): AccountScope {
  if (column.accountId) return 'account'
  // cross-account を宣言していない種別で accountId が無いものは「アカウント
  // なし」に倒す。per-account 専用種別で accountId が失われた個体も束ねる対象を
  // 持たないので、ここに落ちるのが正しい
  return CROSS_ACCOUNT_TYPES.has(column.type) ? 'all' : 'none'
}

/** 全アカウントを束ねるカラムか。カラム未解決 (null/undefined) は false */
export function isAllAccounts(column: ColumnLike | null | undefined): boolean {
  return !!column && getAccountScope(column) === 'all'
}

/** アカウントに紐づかないカラムか。カラム未解決 (null/undefined) は false */
export function isAccountIndependent(
  column: ColumnLike | null | undefined,
): boolean {
  return !!column && getAccountScope(column) === 'none'
}

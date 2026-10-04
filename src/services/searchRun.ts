/**
 * クライアント検索の「検索を始めるか」と「自動で続けるか」の純ロジック (#1178)。
 *
 * 検索を始める規則は 1 つ: 検索語 / フィルターの行 / 本文の条件 / 条件に数える
 * クエリ のいずれかがあれば検索し、1 つも無ければ案内に戻る (索引全件は出さない)。
 * 自動続行は利用者の明示の操作で始まった走査だけで、表示が一画面に満たない間か
 * 直前のページで 1 件も足せなかった間、走査した件数の上限まで続ける。
 */

import type { ColumnQueryStatus } from '@/services/columnQuery/badge'
import {
  effectiveConditions,
  hasActiveFilter,
  type SearchFilter,
} from '@/services/searchFilter'

/**
 * クエリを「検索を始める条件」に数えるか。
 *
 * fail-open で評価上「無いもの」になっているクエリ (セーフモード / 適用が
 * すべて無効) は数えない — クエリだけを条件にしたカラムが、頼んでいない索引
 * 全件 (フォロワー限定・ダイレクト込み) のダンプに退化しないため。
 * fail-closed (解釈不能 / 参照先が無い) は数えて検索を始め、最初のページで
 * 保留に止める — 黙って外れないという fail-closed の存在理由を保つため。
 */
export function queryCountsAsCondition(status: ColumnQueryStatus): boolean {
  switch (status) {
    case 'active':
    case 'degraded':
    case 'invalid':
      return true
    case 'none':
    case 'safeMode':
    case 'disabled':
      return false
  }
}

export function shouldStartSearch(input: {
  term: string
  filter: SearchFilter
  queryStatus: ColumnQueryStatus
}): boolean {
  return (
    input.term.trim().length > 0 ||
    hasActiveFilter(input.filter) ||
    effectiveConditions(input.filter).length > 0 ||
    queryCountsAsCondition(input.queryStatus)
  )
}

/** 検索を始めた理由。入力中と起動時の復元は最初のページで止める */
export type SearchTrigger = 'typed' | 'restore' | 'explicit'

export function allowsAutoContinue(trigger: SearchTrigger): boolean {
  return trigger === 'explicit'
}

/**
 * 1 回の操作で索引から手元へ運んで判定する件数の上限。タイムラインの索引検索
 * (Rust 側で述語を評価し、合うものだけが IPC を越える) とは費用が違うので
 * 値を揃えない
 */
export const CONTINUE_SCAN_LIMIT = 400

export type ContinueDecision =
  | 'continue'
  | 'stop:filled'
  | 'stop:limit'
  | 'stop:blocked'
  | 'stop:exhausted'

/**
 * 次のページを自動で取りに行くか。
 * - 索引に続きが無ければ終わり
 * - クエリが止まっている (fail-closed / サスペンド) 間は続けない (何も残らないと
 *   分かっている走査に上限を使い切らない)
 * - 上限に達したら止める (止まった理由として見せる)
 * - 表示が一画面に満たない間、または直前のページで 1 件も足せなかった間は続ける
 */
export function decideContinue(input: {
  hasMore: boolean
  queryBlocked: boolean
  scanned: number
  limit?: number
  viewportFilled: boolean
  lastAdded: number
}): ContinueDecision {
  if (!input.hasMore) return 'stop:exhausted'
  if (input.queryBlocked) return 'stop:blocked'
  if (input.scanned >= (input.limit ?? CONTINUE_SCAN_LIMIT)) return 'stop:limit'
  if (!input.viewportFilled || input.lastAdded === 0) return 'continue'
  return 'stop:filled'
}

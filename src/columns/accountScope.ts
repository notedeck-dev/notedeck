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

import { i18n } from '@/i18n'
import type { ColumnType, DeckColumn } from '@/stores/deck'
import {
  ACCOUNT_INDEPENDENT_TYPES,
  COLUMN_REGISTRY,
  CROSS_ACCOUNT_TYPES,
} from './registry'

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

/**
 * 「全アカウント」で開けない理由 (#1017)。カラム追加ダイアログが、対応して
 * いない種別で行を黙って消す代わりに、無効の行と理由を出すために使う。
 * 構造上できないのか、まだ作っていないのかをユーザーが区別できるようにする。
 *
 * - `selectable`: サーバーごとに ID を選ぶ面 (リスト / アンテナ / クリップ /
 *   チャンネル / ロール / ユーザー)。「各アカウントの当該リソースを束ねる」の
 *   意味を決めないと実装できない
 * - `server`: サーバー単位の面 (サーバー情報 / 絵文字 / みつける / チャート
 *   等)。束ねる単位はアカウントではなくサーバーなので、全アカウントの意味が薄い
 * - `unsupported`: 構造上の理由は無く、まだ対応していないだけ
 */
export type CrossAccountUnavailableReason =
  | 'selectable'
  | 'server'
  | 'unsupported'

export const CROSS_ACCOUNT_UNAVAILABLE_LABELS: Record<
  CrossAccountUnavailableReason,
  string
> = {
  get selectable() {
    return i18n.ts._accountScope.selectable
  },
  get server() {
    return i18n.ts._accountScope.server
  },
  get unsupported() {
    return i18n.ts._accountScope.unsupported
  },
}

/** 全アカウントで開ける (または アカウントに紐づかない) 種別なら null */
export function crossAccountUnavailableReason(
  type: ColumnType,
): CrossAccountUnavailableReason | null {
  if (CROSS_ACCOUNT_TYPES.has(type) || ACCOUNT_INDEPENDENT_TYPES.has(type)) {
    return null
  }
  const spec = COLUMN_REGISTRY[type]
  if (spec?.selectable) return 'selectable'
  if (spec?.group === 'server') return 'server'
  return 'unsupported'
}

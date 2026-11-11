/**
 * カラム種別の露出フィルタ (#1034)。
 *
 * 追加導線 (追加ダイアログ / コマンドパレット / ナビバーエディタ / LaunchPad) は
 * 生の ALL_COLUMN_TYPES ではなくここを経由する。生の派生セットは描画や semantics
 * 用に残る — off でもデッキ上の既存カラムは動き続けるため。
 */

import { isExposed } from '@/settings/exposure'
import type { ColumnType } from '@/stores/deck'
import {
  ACCOUNT_INDEPENDENT_TYPES,
  ACCOUNT_OPTIONAL_TYPES,
  ALL_COLUMN_TYPES,
  COLUMN_REGISTRY,
  COLUMN_TYPE_GROUPS,
  type ColumnGroupInfo,
  CROSS_ACCOUNT_TYPES,
} from './registry'

/**
 * 追加導線に出してよいカラム種別。
 * 未登録の種別 (プラグイン起動前など) は既存カラムを消さないため通す。
 */
export function isColumnExposed(type: ColumnType): boolean {
  const spec = COLUMN_REGISTRY[type]
  if (!spec) return true
  return isExposed(spec.exposure)
}

/** 追加導線が列挙するカラム種別 (registry 宣言順) */
export function exposedColumnTypes(): ColumnType[] {
  return ALL_COLUMN_TYPES.filter(isColumnExposed)
}

/**
 * ナビバーの「もっと」(LaunchPad) に並べる種別。ひと押しで accountId: null のまま
 * 開けるものだけ — 全アカウント / アカウント非依存 / アカウント「なし」を選べる種別で、
 * ID 選択 (selectable) が要らず、ナビバーに無いもの。
 */
export function launchPadColumnTypes(
  navTypes: ReadonlySet<string>,
): ColumnType[] {
  return exposedColumnTypes().filter((t) => {
    if (navTypes.has(t)) return false
    if (COLUMN_REGISTRY[t]?.selectable) return false
    return (
      CROSS_ACCOUNT_TYPES.has(t) ||
      ACCOUNT_INDEPENDENT_TYPES.has(t) ||
      ACCOUNT_OPTIONAL_TYPES.has(t)
    )
  })
}

/**
 * 追加ダイアログ / コマンドパレットが使う UI グループ。
 * 中身が空になったグループは落とす (見出しだけが残らないように)。
 */
export function exposedColumnGroups(): ColumnGroupInfo[] {
  return COLUMN_TYPE_GROUPS.map((g) => ({
    ...g,
    types: g.types.filter(isColumnExposed),
  })).filter((g) => g.types.length > 0)
}

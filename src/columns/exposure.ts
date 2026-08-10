/**
 * カラム種別の露出フィルタ (#1034)。
 *
 * 追加導線 (追加ダイアログ / コマンドパレット / ナビバーエディタ / LaunchPad) は
 * 生の ALL_COLUMN_TYPES ではなくここを経由する。生の派生セットは描画や semantics
 * 用に残る — off でもデッキ上の既存カラムは動き続けるため。
 */

import { isExposed } from '@/settings/exposure'
import type { ColumnType } from '@/stores/deck'
import { ALL_COLUMN_TYPES, COLUMN_REGISTRY } from './registry'

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

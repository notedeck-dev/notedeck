/**
 * カラムヘッダのクエリバッジの文言とアイコン (#783 / #971 / #1043)。
 * per-account (DeckNoteColumn) と全アカウント面 (DeckTimelineColumn) で同じ
 * 表示を出すための純関数。
 */

import { i18n } from '@/i18n'

export type ColumnQueryStatus =
  | 'none'
  | 'safeMode'
  | 'disabled'
  | 'invalid'
  | 'degraded'
  | 'active'

export interface ColumnQueryBadgeState {
  status: ColumnQueryStatus
  /** 無効化された参照の名前 (#1043)。適用中なのに効いていないものを tooltip に添える */
  disabled: readonly string[]
}

export function queryBadgeTitle(
  state: ColumnQueryBadgeState,
  errorCount: number,
): string {
  if (state.status === 'safeMode') {
    return i18n.ts._badge.safeMode
  }
  if (state.status === 'invalid') {
    return i18n.ts._badge.invalid
  }
  // 適用がすべて無効 (#1043): 意図的な停止なのでセーフモードとは別文言
  if (state.status === 'disabled') {
    return i18n.ts._badge.allDisabled
  }
  const errors =
    errorCount > 0
      ? i18n.tsx._badge.excludedErrors_plural({ count: errorCount })
      : ''
  const disabled =
    state.disabled.length > 0
      ? i18n.tsx._badge.disabledNames({ names: state.disabled.join(', ') })
      : ''
  if (state.status === 'degraded') {
    return i18n.tsx._badge.degraded({ errors, disabled })
  }
  return i18n.tsx._badge.active({ errors, disabled })
}

/**
 * 稲妻はストリーミングモードの表示で使っているので避け、隣のフィルタボタンと
 * 文脈が揃うフィルタ軸で示す。逐次適用は「1 件ずつ時間をかけて判定する」ので
 * 砂時計。停止系 (セーフモード / 全適用が無効) はフィルタ軸のまま「効いて
 * いない」を示す
 */
export function queryBadgeIcon(status: ColumnQueryStatus): string {
  switch (status) {
    case 'invalid':
      return 'ti ti-alert-triangle'
    case 'degraded':
      return 'ti ti-hourglass'
    case 'safeMode':
    case 'disabled':
      return 'ti ti-filter-off'
    default:
      return 'ti ti-filter-check'
  }
}

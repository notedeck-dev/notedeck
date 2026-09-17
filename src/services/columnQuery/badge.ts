/**
 * カラムヘッダのクエリバッジの文言とアイコン (#783 / #971 / #1043)。
 * per-account (DeckNoteColumn) と全アカウント面 (DeckTimelineColumn) で同じ
 * 表示を出すための純関数。
 */
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

const HINT = ' — 押すとクエリ管理カラムを開きます'

export function queryBadgeTitle(
  state: ColumnQueryBadgeState,
  errorCount: number,
): string {
  if (state.status === 'safeMode') {
    return `セーフモード中はクエリを停止しています — 絞り込まずに全件表示中。押すとクエリ管理カラムを開きます`
  }
  if (state.status === 'invalid') {
    return `クエリを解釈できません${HINT}`
  }
  // 適用がすべて無効 (#1043): 意図的な停止なのでセーフモードとは別文言
  if (state.status === 'disabled') {
    return '適用中のクエリはすべて無効です — 絞り込まずに全件表示中。押すとクエリ管理カラムを開きます'
  }
  const err = errorCount > 0 ? ` (評価エラー ${errorCount} 件を除外)` : ''
  const off =
    state.disabled.length > 0 ? ` (無効: ${state.disabled.join(', ')})` : ''
  if (state.status === 'degraded') {
    return `クエリ適用中 — 1 件ずつ判定するため検索では使えません${err}${off}${HINT}`
  }
  return `クエリ適用中${err}${off}${HINT}`
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

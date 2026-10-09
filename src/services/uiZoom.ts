/** UI ズーム (webview の拡大率) の許容範囲と刻み。settings.json5 の `ui.zoom` */
export const UI_ZOOM_MIN = 0.5
export const UI_ZOOM_MAX = 2
const UI_ZOOM_STEP = 0.1

/** 未設定・手編集で壊れた値は等倍、範囲外は丸める */
export function clampUiZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return (
    Math.round(Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, value)) * 100) / 100
  )
}

/** 1 段拡大 (+1) / 縮小 (-1) した値 */
export function stepUiZoom(current: number, direction: 1 | -1): number {
  return clampUiZoom(current + direction * UI_ZOOM_STEP)
}

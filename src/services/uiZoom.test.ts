import { describe, expect, it } from 'vitest'
import { clampUiZoom, stepUiZoom, UI_ZOOM_MAX, UI_ZOOM_MIN } from './uiZoom'

describe('clampUiZoom', () => {
  it('未設定・壊れた値は等倍', () => {
    expect(clampUiZoom(undefined)).toBe(1)
    expect(clampUiZoom('1.2')).toBe(1)
    expect(clampUiZoom(Number.NaN)).toBe(1)
  })

  it('手編集の範囲外は丸める', () => {
    expect(clampUiZoom(10)).toBe(UI_ZOOM_MAX)
    expect(clampUiZoom(0.1)).toBe(UI_ZOOM_MIN)
  })
})

describe('stepUiZoom', () => {
  it('0.1 刻みで浮動小数の誤差を残さない', () => {
    expect(stepUiZoom(1, 1)).toBe(1.1)
    expect(stepUiZoom(1.1, 1)).toBe(1.2)
    expect(stepUiZoom(1, -1)).toBe(0.9)
    expect(stepUiZoom(0.7, -1)).toBe(0.6)
  })

  it('上下限で止まる', () => {
    expect(stepUiZoom(UI_ZOOM_MAX, 1)).toBe(UI_ZOOM_MAX)
    expect(stepUiZoom(UI_ZOOM_MIN, -1)).toBe(UI_ZOOM_MIN)
  })
})

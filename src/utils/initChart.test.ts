import { Chart } from 'chart.js'
import { describe, expect, it } from 'vitest'
import { applyAlpha, getHeatmapColor } from './initChart'

describe('initChart の登録', () => {
  it('import するだけで使う chart 種の controller / scale / plugin が登録される', () => {
    expect(Chart.registry.getController('matrix')).toBeDefined()
    expect(Chart.registry.getController('bar')).toBeDefined()
    expect(Chart.registry.getController('line')).toBeDefined()
    expect(Chart.registry.getScale('time')).toBeDefined()
    expect(Chart.registry.getScale('category')).toBeDefined()
    expect(Chart.registry.getScale('linear')).toBeDefined()
    expect(Chart.registry.getPlugin('gradient')).toBeDefined()
    expect(Chart.registry.getPlugin('filler')).toBeDefined()
  })

  it('アニメーションを全体で無効にする', () => {
    expect(Chart.defaults.animation).toBe(false)
  })
})

describe('getHeatmapColor', () => {
  it('ダーク / ライトで本家と同じ固定色を返す', () => {
    expect(getHeatmapColor(true)).toBe('#b4e900')
    expect(getHeatmapColor(false)).toBe('#86b300')
  })
})

describe('applyAlpha', () => {
  it('#RRGGBB を rgba に変換する', () => {
    expect(applyAlpha('#86b300', 0.5)).toBe('rgba(134, 179, 0, 0.5)')
  })

  it('先頭の # が無くても同じように変換する', () => {
    expect(applyAlpha('b4e900', 1)).toBe('rgba(180, 233, 0, 1)')
  })

  it('大文字の 16 進数も読む', () => {
    expect(applyAlpha('#FFFFFF', 0)).toBe('rgba(255, 255, 255, 0)')
  })

  it('alpha は 0〜1 に丸める', () => {
    expect(applyAlpha('#000000', -0.5)).toBe('rgba(0, 0, 0, 0)')
    expect(applyAlpha('#000000', 2)).toBe('rgba(0, 0, 0, 1)')
  })

  it('#RGB の短縮形は #RRGGBB に展開して変換する', () => {
    expect(applyAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(applyAlpha('0a8', 0.5)).toBe('rgba(0, 170, 136, 0.5)')
  })
})

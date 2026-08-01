import { describe, expect, it } from 'vitest'
import {
  buildPresetCss,
  EMPTY_PRESETS,
  extractUserCss,
  parsePresetsFromCss,
} from '@/services/cssPresets'

describe('buildPresetCss', () => {
  it('等幅フォントを選ぶと --nd-font-mono を :root で上書きする (#901)', () => {
    const css = buildPresetCss({ ...EMPTY_PRESETS, monoFont: 'M PLUS 1 Code' })
    expect(css).toContain('/* nd-mono-font: M PLUS 1 Code */')
    expect(css).toContain(
      "@import url('https://fonts.googleapis.com/css2?family=M%20PLUS%201%20Code&display=swap');",
    )
    expect(css).toContain(
      ":root { --nd-font-mono: 'M PLUS 1 Code', monospace; }",
    )
  })

  it('システムフォントは @import せずに変数だけ差し替える', () => {
    const css = buildPresetCss({ ...EMPTY_PRESETS, monoFont: 'Consolas' })
    expect(css).not.toContain('@import')
    expect(css).toContain(":root { --nd-font-mono: 'Consolas', monospace; }")
  })

  it('@import は @font-face や通常ルールより前に出す', () => {
    const css = buildPresetCss({
      ...EMPTY_PRESETS,
      customFont: '瀬戸フォント', // @font-face 方式
      monoFont: 'Cascadia Code', // @import 方式
    })
    const importIndex = css.indexOf('@import')
    const fontFaceIndex = css.indexOf('@font-face')
    const ruleIndex = css.indexOf('html { font-family:')
    expect(importIndex).toBeGreaterThanOrEqual(0)
    expect(importIndex).toBeLessThan(fontFaceIndex)
    expect(importIndex).toBeLessThan(ruleIndex)
  })

  it('プリセット未選択なら空文字を返す', () => {
    expect(buildPresetCss(EMPTY_PRESETS)).toBe('')
  })
})

describe('parsePresetsFromCss', () => {
  it('生成した CSS から選択状態を復元できる', () => {
    const presets = {
      ...EMPTY_PRESETS,
      customFont: 'Noto Sans JP',
      monoFont: 'Cascadia Mono',
      fontSize: 2,
      visibilityBg: 'tint',
      hideNoteCounts: 'self',
      hideUserStats: 'all',
    }
    expect(parsePresetsFromCss(buildPresetCss(presets))).toEqual(presets)
  })

  it('マーカーが無い CSS では既定値になる', () => {
    expect(parsePresetsFromCss('body { color: red; }')).toEqual(EMPTY_PRESETS)
  })
})

describe('extractUserCss', () => {
  it('プリセット生成行を取り除きユーザー記述だけ残す', () => {
    const preset = buildPresetCss({
      ...EMPTY_PRESETS,
      monoFont: 'Cascadia Code',
      fontSize: -1,
    })
    const full = `${preset}\n\n.my-rule { color: red; }`
    expect(extractUserCss(full)).toBe('.my-rule { color: red; }')
  })
})

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme } from './applier'

const root = () => document.documentElement.style

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('前のテーマだけが書いた --nd-* は次のテーマで消す (#1246)', () => {
    applyTheme({ bg: '#000', focusRing: '#ff0' })
    expect(root().getPropertyValue('--nd-focusRing')).toBe('#ff0')

    applyTheme({ bg: '#111' })
    expect(root().getPropertyValue('--nd-focusRing')).toBe('')
    expect(root().getPropertyValue('--nd-bg')).toBe('#111')
  })

  it('テーマ以外が書いた --nd-* には触らない', () => {
    root().setProperty('--nd-blur', '4px')
    applyTheme({ bg: '#000', accent: '#f00' })
    applyTheme({ bg: '#111' })
    expect(root().getPropertyValue('--nd-blur')).toBe('4px')
  })

  it('危険な値で上書きを飛ばしたキーも前の値を残さない', () => {
    applyTheme({ bg: '#000', accent: '#f00' })
    applyTheme({ bg: '#000', accent: 'url(x)' })
    expect(root().getPropertyValue('--nd-accent')).toBe('')
  })
})

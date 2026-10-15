import { describe, expect, it } from 'vitest'
import { isImeComposing } from './ime'

const key = (init: { isComposing?: boolean; keyCode?: number }) =>
  ({ isComposing: false, keyCode: 13, ...init }) as KeyboardEvent

describe('isImeComposing', () => {
  it('isComposing が true なら変換中', () => {
    expect(isImeComposing(key({ isComposing: true }))).toBe(true)
  })
  it('isComposing が false でも keyCode 229 なら変換中 (WebKit の確定 Enter)', () => {
    expect(isImeComposing(key({ keyCode: 229 }))).toBe(true)
  })
  it('どちらでもなければ変換中ではない', () => {
    expect(isImeComposing(key({}))).toBe(false)
    expect(isImeComposing(key({ keyCode: 0 }))).toBe(false)
  })
})

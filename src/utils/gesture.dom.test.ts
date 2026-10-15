// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { isFromNestedOverlay } from './gesture'

describe('isFromNestedOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function setup(html: string) {
    document.body.innerHTML = html
    const boundary = document.getElementById('boundary') as HTMLElement
    const target = document.getElementById('target') as HTMLElement
    return { boundary, target }
  }

  it('境界の内側にある dialog の中からの touch なら true', () => {
    const { boundary, target } = setup(
      '<div id="boundary"><dialog><span id="target"></span></dialog></div>',
    )
    expect(isFromNestedOverlay(target, boundary)).toBe(true)
  })

  it('境界の内側にある [popover] の中からの touch なら true', () => {
    const { boundary, target } = setup(
      '<div id="boundary"><div popover><span id="target"></span></div></div>',
    )
    expect(isFromNestedOverlay(target, boundary)).toBe(true)
  })

  it('境界自身を包む dialog (ウィンドウ表示のカラム) は対象外', () => {
    const { boundary, target } = setup(
      '<dialog><div id="boundary"><span id="target"></span></div></dialog>',
    )
    expect(isFromNestedOverlay(target, boundary)).toBe(false)
  })

  it('オーバーレイを経由しない通常の子要素なら false', () => {
    const { boundary, target } = setup(
      '<div id="boundary"><span id="target"></span></div>',
    )
    expect(isFromNestedOverlay(target, boundary)).toBe(false)
  })

  it('target が null や Element でないなら false', () => {
    const { boundary } = setup('<div id="boundary"></div>')
    expect(isFromNestedOverlay(null, boundary)).toBe(false)
    expect(isFromNestedOverlay(window, boundary)).toBe(false)
    expect(isFromNestedOverlay(document.createTextNode('t'), boundary)).toBe(
      false,
    )
  })
})

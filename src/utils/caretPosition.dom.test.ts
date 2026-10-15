// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCaretCoordinates } from './caretPosition'

function makeTextarea(value: string, style: Partial<CSSStyleDeclaration> = {}) {
  const ta = document.createElement('textarea')
  ta.value = value
  Object.assign(ta.style, style)
  document.body.appendChild(ta)
  return ta
}

// mirror div は測った直後に外されるので、body に足された瞬間を捕まえる
function captureMirror() {
  const captured: HTMLElement[] = []
  const original = document.body.appendChild.bind(document.body)
  vi.spyOn(document.body, 'appendChild').mockImplementation(
    <T extends Node>(node: T) => {
      if (node instanceof HTMLElement) captured.push(node)
      return original(node)
    },
  )
  return captured
}

describe('getCaretCoordinates', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('mirror に caret 前のテキストと、caret 位置の 1 文字を入れた marker を置く', () => {
    const ta = makeTextarea('hello world')
    const captured = captureMirror()
    getCaretCoordinates(ta, 5)
    const mirror = captured[0]
    expect(mirror?.firstChild?.textContent).toBe('hello')
    expect(mirror?.querySelector('span')?.textContent).toBe(' ')
  })

  it('caret が末尾なら marker は "." で埋める (幅 0 回避)', () => {
    const ta = makeTextarea('abc')
    const captured = captureMirror()
    getCaretCoordinates(ta, 3)
    expect(captured[0]?.querySelector('span')?.textContent).toBe('.')
  })

  it('mirror は隠した絶対配置で、測定後に DOM から外す', () => {
    const ta = makeTextarea('abc')
    const captured = captureMirror()
    const before = document.body.childElementCount
    getCaretCoordinates(ta, 1)
    const mirror = captured[0] as HTMLElement
    expect(mirror.style.position).toBe('absolute')
    expect(mirror.style.visibility).toBe('hidden')
    expect(mirror.isConnected).toBe(false)
    expect(document.body.childElementCount).toBe(before)
  })

  it('textarea の white-space に関わらず mirror は pre-wrap で折り返す', () => {
    const ta = makeTextarea('abc', { whiteSpace: 'nowrap' })
    const captured = captureMirror()
    getCaretCoordinates(ta, 1)
    expect(captured[0]?.style.whiteSpace).toBe('pre-wrap')
  })

  it('height は line-height を使う', () => {
    const ta = makeTextarea('abc', { lineHeight: '20px', fontSize: '10px' })
    expect(getCaretCoordinates(ta, 0).height).toBe(20)
  })

  it('line-height が数値で読めなければ font-size の 1.4 倍', () => {
    const ta = makeTextarea('abc', { lineHeight: 'normal', fontSize: '10px' })
    expect(getCaretCoordinates(ta, 0).height).toBeCloseTo(14)
  })

  it('left / top は marker の offset をそのまま返す', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(12)
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(34)
    const ta = makeTextarea('abc')
    const r = getCaretCoordinates(ta, 1)
    expect(r.left).toBe(12)
    expect(r.top).toBe(34)
  })
})

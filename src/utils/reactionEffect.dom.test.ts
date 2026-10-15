// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnReactionEffect } from './reactionEffect'

function makeButton(inner: string): HTMLElement {
  const button = document.createElement('button')
  button.innerHTML = inner
  document.body.appendChild(button)
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 200,
  } as DOMRect)
  Object.defineProperty(button, 'offsetHeight', { value: 30 })
  return button
}

/** ボタン以外に body へ足された要素 = エフェクトのコンテナ */
function effects(button: HTMLElement): HTMLElement[] {
  return [...document.body.children].filter(
    (el): el is HTMLElement => el !== button,
  )
}

/** エフェクトがちょうど 1 つ出ていることを確かめて返す */
function onlyEffect(button: HTMLElement): HTMLElement {
  const list = effects(button)
  expect(list).toHaveLength(1)
  return list[0] as HTMLElement
}

describe('spawnReactionEffect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    })
  })

  it('ボタンの左端から 16px・縦中央を中心に 128px 四方の固定コンテナを置く', () => {
    const button = makeButton('<span>3</span>')
    spawnReactionEffect(button)

    const container = onlyEffect(button)
    expect(container.style.position).toBe('fixed')
    expect(container.style.pointerEvents).toBe('none')
    // x = 100 + 16, y = 200 + 30 / 2 → 中心から 64px 引く
    expect(container.style.left).toBe('52px')
    expect(container.style.top).toBe('151px')
  })

  it('img を持つボタンでは img を複製して表示する (元の img は動かさない)', () => {
    const button = makeButton(
      '<img src="https://example.com/e.png"><span>3</span>',
    )
    spawnReactionEffect(button)

    const container = onlyEffect(button)
    const clone = container.querySelector('img')
    expect(clone).not.toBeNull()
    expect(clone?.getAttribute('src')).toBe('https://example.com/e.png')
    expect(clone?.style.height).toBe('1em')
    expect(button.querySelector('img')).not.toBeNull()
  })

  it('img が無いボタンでは最初の span (件数) を除いたテキストを表示する', () => {
    const button = makeButton(' 👍 <span>12</span>')
    spawnReactionEffect(button)

    const container = onlyEffect(button)
    expect(container.querySelector('span')?.textContent).toBe('👍')
    // 元のボタンの件数表示は残る
    expect(button.querySelector('span')?.textContent).toBe('12')
  })

  it('10ms 後に透明化と上方向への移動を適用する', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    const button = makeButton('👍<span>1</span>')
    spawnReactionEffect(button)

    const text = onlyEffect(button).querySelector('span') as HTMLElement
    expect(text.style.opacity).toBe('')

    vi.advanceTimersByTime(10)
    expect(text.style.opacity).toBe('0')
    // angle = 90 - 0.25 * 180
    expect(text.style.transform).toBe('translateY(-50px) rotateZ(45deg)')
  })

  it('1100ms 経つとコンテナを取り除く', () => {
    const button = makeButton('👍<span>1</span>')
    spawnReactionEffect(button)

    vi.advanceTimersByTime(1099)
    expect(effects(button)).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(effects(button)).toHaveLength(0)
  })

  it('連続で呼ぶとそれぞれ独立したコンテナを出す', () => {
    const button = makeButton('👍<span>1</span>')
    spawnReactionEffect(button)
    spawnReactionEffect(button)
    expect(effects(button)).toHaveLength(2)
  })

  it('ページが非表示のときは何も足さない', () => {
    Object.defineProperty(document, 'hidden', {
      value: true,
      configurable: true,
    })
    const button = makeButton('👍<span>1</span>')
    spawnReactionEffect(button)

    expect(effects(button)).toHaveLength(0)
    vi.advanceTimersByTime(2000)
    expect(document.body.children).toHaveLength(1)
  })
})

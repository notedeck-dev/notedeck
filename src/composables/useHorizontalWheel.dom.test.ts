import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useHorizontalWheel } from './useHorizontalWheel'

function setup() {
  const container = document.createElement('div')
  const column = document.createElement('div')
  column.className = 'deck-column'
  const body = document.createElement('div')
  column.appendChild(body)
  container.appendChild(column)
  document.body.appendChild(container)
  const wheel = useHorizontalWheel({
    containerRef: ref(container),
    columnSelector: '.deck-column',
  })
  return { container, column, body, wheel }
}

function wheelOn(el: HTMLElement, init: WheelEventInit) {
  const ev = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  // happy-dom の WheelEvent は修飾キーの init を受け取らない
  Object.defineProperty(ev, 'shiftKey', { value: !!init.shiftKey })
  el.dispatchEvent(ev)
  return ev
}

describe('useHorizontalWheel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0),
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('カラムの外の縦ホイールは横スクロールに変換する', async () => {
    const { container, wheel } = setup()
    await wheel.attach()
    wheelOn(container, { deltaY: 100 })
    vi.runAllTimers()
    expect(container.scrollLeft).toBe(100)
    wheel.detach()
  })

  it('カラムの上の素の縦ホイールはカラムの縦スクロールに任せる', async () => {
    const { container, body, wheel } = setup()
    await wheel.attach()
    const ev = wheelOn(body, { deltaY: 100 })
    vi.runAllTimers()
    expect(container.scrollLeft).toBe(0)
    expect(ev.defaultPrevented).toBe(false)
    wheel.detach()
  })

  it('カラムの上でも Shift+ホイールは横スクロールにする', async () => {
    const { container, body, wheel } = setup()
    await wheel.attach()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
    const ev = wheelOn(body, { deltaY: 120, shiftKey: true })
    vi.runAllTimers()
    expect(container.scrollLeft).toBe(120)
    // カラムの縦スクロールを止める
    expect(ev.defaultPrevented).toBe(true)
    wheel.detach()
  })

  it('Shift+ホイールが deltaX で届く環境でもカラムの上で横スクロールにする', async () => {
    const { container, body, wheel } = setup()
    await wheel.attach()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
    wheelOn(body, { deltaX: 80, shiftKey: true })
    vi.runAllTimers()
    expect(container.scrollLeft).toBe(80)
    wheel.detach()
  })

  it('Shift を離したら非 passive の購読を外す', async () => {
    const { container, body, wheel } = setup()
    await wheel.attach()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }))
    // keyup 後に (修飾の取りこぼしで) shiftKey 付きが来ても横変換しない
    const ev = wheelOn(body, { deltaY: 100, shiftKey: true })
    vi.runAllTimers()
    expect(ev.defaultPrevented).toBe(false)
    expect(container.scrollLeft).toBe(0)
    wheel.detach()
  })
})

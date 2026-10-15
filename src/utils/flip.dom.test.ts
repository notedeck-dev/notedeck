// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureFlip, playFlip } from './flip'

type Rect = { left: number; top: number }

function makeEl(key: string | undefined, rect: Rect) {
  const el = document.createElement('div')
  if (key !== undefined) el.dataset.key = key
  let current = rect
  el.getBoundingClientRect = () =>
    ({ left: current.left, top: current.top }) as DOMRect
  const animate = vi.fn(
    (_frames: Keyframe[], _opts?: KeyframeAnimationOptions) =>
      ({}) as Animation,
  )
  el.animate = animate as unknown as HTMLElement['animate']
  return {
    el,
    animate,
    moveTo(r: Rect) {
      current = r
    },
  }
}

const keyOf = (el: HTMLElement) => el.dataset.key

function container(scrollLeft: number, scrollTop: number) {
  return { scrollLeft, scrollTop } as HTMLElement
}

function setReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) => ({ matches: reduce, media: q }) as MediaQueryList,
  )
}

describe('captureFlip', () => {
  it('キーのある要素だけ、容器のスクロール量を足した座標で記録する', () => {
    const a = makeEl('a', { left: 10, top: 20 })
    const b = makeEl(undefined, { left: 0, top: 0 })
    const snap = captureFlip([a.el, b.el], keyOf, container(5, 100))
    expect([...snap.entries()]).toEqual([['a', { x: 15, y: 120 }]])
  })

  it('容器が無ければスクロール補正なし', () => {
    const a = makeEl('a', { left: 10, top: 20 })
    expect(captureFlip([a.el], keyOf, null).get('a')).toEqual({ x: 10, y: 20 })
  })
})

describe('playFlip', () => {
  beforeEach(() => {
    setReducedMotion(false)
    document.documentElement.style.setProperty('--nd-duration-slow', '0.3s')
    document.documentElement.style.setProperty('--nd-ease-decel', 'linear')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('style')
  })

  it('記録位置から今の位置への差分を translate で 0 まで補間する', () => {
    const a = makeEl('a', { left: 0, top: 0 })
    const snap = captureFlip([a.el], keyOf)
    a.moveTo({ left: 30, top: -10 })
    playFlip(snap, [a.el], keyOf)
    expect(a.animate).toHaveBeenCalledOnce()
    const [frames, opts] = a.animate.mock.calls[0] ?? []
    expect(frames).toEqual([{ translate: '-30px 10px' }, { translate: '0 0' }])
    expect(opts?.duration).toBe(300)
    expect(opts?.easing).toBe('linear')
  })

  it('記録と再生の間の容器スクロールは移動と見なさない', () => {
    const a = makeEl('a', { left: 0, top: 100 })
    const snap = captureFlip([a.el], keyOf, container(0, 0))
    a.moveTo({ left: 0, top: 50 })
    playFlip(snap, [a.el], keyOf, container(0, 50))
    expect(a.animate).not.toHaveBeenCalled()
  })

  it('移動が 1px 未満なら補間しない', () => {
    const a = makeEl('a', { left: 0, top: 0 })
    const snap = captureFlip([a.el], keyOf)
    a.moveTo({ left: 0.5, top: -0.9 })
    playFlip(snap, [a.el], keyOf)
    expect(a.animate).not.toHaveBeenCalled()
  })

  it('記録に無い (新しく現れた) 要素とキーの無い要素は対象外', () => {
    const a = makeEl('a', { left: 0, top: 0 })
    const snap = captureFlip([a.el], keyOf)
    const fresh = makeEl('new', { left: 50, top: 50 })
    const keyless = makeEl(undefined, { left: 50, top: 50 })
    playFlip(snap, [fresh.el, keyless.el], keyOf)
    expect(fresh.animate).not.toHaveBeenCalled()
    expect(keyless.animate).not.toHaveBeenCalled()
  })

  it('axis で片方向だけに絞る', () => {
    const a = makeEl('a', { left: 0, top: 0 })
    const snap = captureFlip([a.el], keyOf)
    a.moveTo({ left: 20, top: 40 })
    playFlip(snap, [a.el], keyOf, null, 'y')
    expect(a.animate.mock.calls[0]?.[0]).toEqual([
      { translate: '0px -40px' },
      { translate: '0 0' },
    ])
  })

  it('絞った軸の移動が 1px 未満なら、もう片方が動いていても補間しない', () => {
    const a = makeEl('a', { left: 0, top: 0 })
    const snap = captureFlip([a.el], keyOf)
    a.moveTo({ left: 100, top: 0 })
    playFlip(snap, [a.el], keyOf, null, 'y')
    expect(a.animate).not.toHaveBeenCalled()
  })

  it('durationToken を差し替えられ、トークンが無ければ 280ms', () => {
    const a = makeEl('a', { left: 0, top: 0 })
    const snap = captureFlip([a.el], keyOf)
    a.moveTo({ left: 10, top: 0 })
    playFlip(snap, [a.el], keyOf, null, 'both', '--nd-duration-missing')
    expect(a.animate.mock.calls[0]?.[1]?.duration).toBe(280)
  })

  it('reduced-motion なら何もしない', () => {
    setReducedMotion(true)
    const a = makeEl('a', { left: 0, top: 0 })
    const snap = captureFlip([a.el], keyOf)
    a.moveTo({ left: 100, top: 100 })
    playFlip(snap, [a.el], keyOf)
    expect(a.animate).not.toHaveBeenCalled()
  })

  it('duration トークンが 0 なら何もしない', () => {
    document.documentElement.style.setProperty('--nd-duration-slow', '0s')
    const a = makeEl('a', { left: 0, top: 0 })
    const snap = captureFlip([a.el], keyOf)
    a.moveTo({ left: 100, top: 100 })
    playFlip(snap, [a.el], keyOf)
    expect(a.animate).not.toHaveBeenCalled()
  })
})

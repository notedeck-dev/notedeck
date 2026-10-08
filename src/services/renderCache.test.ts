import { describe, expect, it, vi } from 'vitest'
import { createRenderCache } from './renderCache'

describe('createRenderCache', () => {
  it('同じ入力なら 2 回目は計算しない', () => {
    const cache = createRenderCache(10)
    const compute = vi.fn(() => '<p>hi</p>')

    expect(cache.render('m1', 'hi', 0, compute)).toBe('<p>hi</p>')
    expect(cache.render('m1', 'hi', 0, compute)).toBe('<p>hi</p>')
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('入力が変わった枠だけ計算し直す', () => {
    const cache = createRenderCache(10)
    const stable = vi.fn(() => 'A')
    const streaming = vi.fn((): string => 'B')

    cache.render('m1', 'done', 0, stable)
    cache.render('m2', 'wor', 0, streaming)
    // ストリームで末尾だけ伸びる
    cache.render('m1', 'done', 0, stable)
    cache.render('m2', 'work', 0, streaming)

    expect(stable).toHaveBeenCalledTimes(1)
    expect(streaming).toHaveBeenCalledTimes(2)
  })

  it('revision が進むと全枠を計算し直す', () => {
    const cache = createRenderCache(10)
    const compute = vi.fn(() => 'X')

    cache.render('m1', 'same', 0, compute)
    cache.render('m1', 'same', 1, compute)

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('上限を超えたら古い枠から捨てる', () => {
    const cache = createRenderCache(2)
    const compute = () => 'X'

    cache.render('m1', 'a', 0, compute)
    cache.render('m2', 'b', 0, compute)
    cache.render('m3', 'c', 0, compute)

    expect(cache.size()).toBe(2)
    // m1 は捨てられているので再計算になる
    const recompute = vi.fn(() => 'X')
    cache.render('m1', 'a', 0, recompute)
    expect(recompute).toHaveBeenCalledTimes(1)
  })

  it('既存の枠の更新では他の枠を押し出さない', () => {
    const cache = createRenderCache(2)
    const compute = () => 'X'
    cache.render('m1', 'a', 0, compute)
    cache.render('m2', 'b', 0, compute)

    // m2 をストリームのように何度も更新しても m1 は残る
    for (const s of ['bb', 'bbb', 'bbbb']) cache.render('m2', s, 0, compute)

    const stillCached = vi.fn(() => 'X')
    cache.render('m1', 'a', 0, stillCached)
    expect(stillCached).not.toHaveBeenCalled()
    expect(cache.size()).toBe(2)
  })
})

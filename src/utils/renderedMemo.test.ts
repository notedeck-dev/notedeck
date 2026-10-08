import { describe, expect, it } from 'vitest'
import { createRenderedMemo } from './renderedMemo'

describe('createRenderedMemo', () => {
  it('追加したキーを覚えている', () => {
    const memo = createRenderedMemo(10)
    memo.add('a')
    expect(memo.has('a')).toBe(true)
    expect(memo.has('b')).toBe(false)
  })

  it('上限を超えると古いキーから忘れる', () => {
    const memo = createRenderedMemo(2)
    memo.add('a')
    memo.add('b')
    memo.add('c')
    expect(memo.has('a')).toBe(false)
    expect(memo.has('b')).toBe(true)
    expect(memo.has('c')).toBe(true)
  })

  it('既にあるキーを足し直すと新しい側に回る', () => {
    const memo = createRenderedMemo(2)
    memo.add('a')
    memo.add('b')
    memo.add('a')
    memo.add('c')
    expect(memo.has('a')).toBe(true)
    expect(memo.has('b')).toBe(false)
  })
})

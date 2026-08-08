import { describe, expect, it } from 'vitest'
import {
  insertColumnAt,
  isInsertNoop,
  toGlobalInsertIndex,
} from '@/utils/deckLayout'

describe('isInsertNoop', () => {
  it('単独カラムを自分の位置へ挿入すると no-op', () => {
    expect(isInsertNoop([['a'], ['b']], 'a', 0)).toBe(true)
  })

  it('単独カラムを自分のすぐ右の隙間へ挿入すると no-op', () => {
    expect(isInsertNoop([['a'], ['b']], 'a', 1)).toBe(true)
  })

  it('単独カラムを離れた位置へ挿入するのは no-op ではない', () => {
    expect(isInsertNoop([['a'], ['b']], 'a', 2)).toBe(false)
  })

  it('スタック中のカラムを自分のグループの隣へ挿入するのは no-op ではない', () => {
    // グループから抜けて単独カラムになるので変化がある
    expect(isInsertNoop([['a', 'b'], ['c']], 'b', 0)).toBe(false)
    expect(isInsertNoop([['a', 'b'], ['c']], 'b', 1)).toBe(false)
  })

  it('レイアウトに存在しないカラムは no-op ではない', () => {
    expect(isInsertNoop([['a']], 'zzz', 0)).toBe(false)
  })
})

describe('insertColumnAt', () => {
  it('スタック中のカラムを自分のグループの右隣へ出すと単独カラムになる', () => {
    expect(insertColumnAt([['a', 'b'], ['c']], 'b', 1)).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ])
  })

  it('デッキが分割グループ 1 つだけでも取り出せる', () => {
    expect(insertColumnAt([['a', 'b']], 'b', 1)).toEqual([['a'], ['b']])
    expect(insertColumnAt([['a', 'b']], 'b', 0)).toEqual([['b'], ['a']])
  })

  it('単独カラムを同じ位置へ挿入しても何も起きない', () => {
    expect(insertColumnAt([['a'], ['b']], 'a', 0)).toBeNull()
    expect(insertColumnAt([['a'], ['b']], 'a', 1)).toBeNull()
  })
})

describe('toGlobalInsertIndex', () => {
  // b は別ウィンドウに切り出し済み: 画面に見えているのは a, c だけ
  const layout = [['a'], ['b'], ['c']]
  const windowLayout = [['a'], ['c']]

  it('ウィンドウ内の先頭はデッキ全体でも先頭', () => {
    expect(toGlobalInsertIndex(layout, windowLayout, 0)).toBe(0)
  })

  it('見えているカラムの間は、そのカラムの全体での位置になる', () => {
    expect(toGlobalInsertIndex(layout, windowLayout, 1)).toBe(2)
  })

  it('ウィンドウ内の末尾は、最後に見えているカラムの直後', () => {
    expect(toGlobalInsertIndex(layout, windowLayout, 2)).toBe(3)
  })

  it('切り出したカラムがなければ位置は変わらない', () => {
    expect(toGlobalInsertIndex(layout, layout, 1)).toBe(1)
    expect(toGlobalInsertIndex(layout, layout, 3)).toBe(3)
  })

  it('このウィンドウにカラムがなければ末尾', () => {
    expect(toGlobalInsertIndex(layout, [], 0)).toBe(3)
  })
})

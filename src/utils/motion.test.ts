import { describe, expect, it } from 'vitest'
import { parseCssDuration } from './motion'

describe('parseCssDuration', () => {
  it('秒指定をミリ秒に直す', () => {
    expect(parseCssDuration('0.28s')).toBe(280)
  })

  it('ミリ秒指定はそのまま返す', () => {
    expect(parseCssDuration(' 150ms ')).toBe(150)
  })

  it('解釈できない値はフォールバックを返す', () => {
    expect(parseCssDuration('', 200)).toBe(200)
    expect(parseCssDuration('var(--x)', 120)).toBe(120)
  })
})

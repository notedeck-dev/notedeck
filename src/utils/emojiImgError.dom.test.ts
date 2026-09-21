import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onCustomEmojiImgError } from './emojiImgError'

/**
 * カスタム絵文字 `<img>` の error ハンドラ (#844)。
 *
 * プロキシは上流の一時失敗 (negative cache 5s / circuit breaker の
 * half-open 待ち / 起動時にネットワークが未接続) で 502 を返すことがあり、
 * error を受けた瞬間に unknown アイコンへ置き換えると、その絵文字は
 * 再描画されるまで二度と戻らない。数回だけ間を空けて再要求し、それでも
 * 駄目なら unknown に倒す。
 */

const PROXIED =
  'http://127.0.0.1:19820/proxy/image?url=https%3A%2F%2Fexample.com%2Fa.png&h=128&t=abc'

function fire(img: HTMLImageElement) {
  onCustomEmojiImgError({ target: img } as unknown as Event)
}

describe('onCustomEmojiImgError', () => {
  let img: HTMLImageElement

  beforeEach(() => {
    vi.useFakeTimers()
    img = document.createElement('img')
    img.src = PROXIED
    document.body.appendChild(img)
  })

  afterEach(() => {
    img.remove()
    vi.useRealTimers()
  })

  it('初回の失敗では unknown に倒さず、間を空けて世代付き URL で再要求する', () => {
    fire(img)
    expect(img.src).toBe(PROXIED)
    vi.advanceTimersByTime(1999)
    expect(img.src).toBe(PROXIED)
    vi.advanceTimersByTime(1)
    expect(img.src).toBe(`${PROXIED}&r=1`)
  })

  it('再試行を使い切ったら unknown アイコンに倒す', () => {
    fire(img)
    vi.runAllTimers()
    expect(img.src).toBe(`${PROXIED}&r=1`)
    fire(img)
    vi.runAllTimers()
    expect(img.src).toBe(`${PROXIED}&r=2`)
    fire(img)
    vi.runAllTimers()
    expect(img.src).toMatch(/\/emoji-unknown\.svg$/)
  })

  it('unknown アイコン自体の失敗は無視する (ループ防止)', () => {
    img.src = '/emoji-unknown.svg'
    fire(img)
    vi.runAllTimers()
    expect(img.src).toMatch(/\/emoji-unknown\.svg$/)
  })

  it('DOM から外れた <img> は再要求しない', () => {
    fire(img)
    img.remove()
    vi.runAllTimers()
    expect(img.src).toBe(PROXIED)
  })

  it('Vue が :src を差し替えたら (世代番号なし) 試行回数は振り出しに戻る', () => {
    fire(img)
    vi.runAllTimers()
    fire(img)
    vi.runAllTimers()
    expect(img.src).toBe(`${PROXIED}&r=2`)
    // 辞書更新などで別 URL に差し替わった
    const other = PROXIED.replace('a.png', 'b.png')
    img.src = other
    fire(img)
    vi.runAllTimers()
    expect(img.src).toBe(`${other}&r=1`)
  })
})

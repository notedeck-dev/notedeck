import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useMediaPlayer } from './useMediaPlayer'

function fakeMedia() {
  return {
    paused: true,
    ended: false,
    currentTime: 10,
    duration: 100,
    volume: 1,
    muted: false,
    playbackRate: 1,
    loop: false,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  }
}

function setup() {
  const el = fakeMedia()
  const player = useMediaPlayer(ref(el as unknown as HTMLMediaElement))
  return { el, player }
}

function key(k: string) {
  return new KeyboardEvent('keydown', { key: k, cancelable: true })
}

describe('useMediaPlayer (#1214)', () => {
  it('停止中は play、再生中は pause', () => {
    const { el, player } = setup()
    player.togglePlay()
    expect(el.play).toHaveBeenCalled()
    el.paused = false
    player.togglePlay()
    expect(el.pause).toHaveBeenCalled()
  })

  it('シークは長さに対する比で、範囲外に出ない', () => {
    const { el, player } = setup()
    player.seekTo(0.5)
    expect(el.currentTime).toBe(50)
    player.seekBy(-100)
    expect(el.currentTime).toBe(0)
    player.seekBy(1000)
    expect(el.currentTime).toBe(100)
  })

  it('ミュートの解除で元の音量に戻る', () => {
    const { el, player } = setup()
    player.setVolume(0.4)
    player.toggleMute()
    expect(el.muted).toBe(true)
    expect(player.effectiveVolume.value).toBe(0)
    player.toggleMute()
    expect(el.muted).toBe(false)
    expect(el.volume).toBe(0.4)
  })

  it('扱うキーだけ止め、ライトボックスの Escape は通す', () => {
    const { el, player } = setup()
    const right = key('ArrowRight')
    expect(player.onKeydown(right)).toBe(true)
    expect(right.defaultPrevented).toBe(true)
    expect(el.currentTime).toBe(15)
    const esc = key('Escape')
    expect(player.onKeydown(esc)).toBe(false)
    expect(esc.defaultPrevented).toBe(false)
  })

  it('速度とループは要素に写す', () => {
    const { el, player } = setup()
    player.setRate(1.5)
    player.toggleLoop()
    expect(el.playbackRate).toBe(1.5)
    expect(el.loop).toBe(true)
  })
})

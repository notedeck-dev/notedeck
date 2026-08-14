import { beforeEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { useNavbarResize } from './useNavbarResize'

function setViewportWidth(w: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: w,
    configurable: true,
  })
}

function setup() {
  const scope = effectScope()
  const api = scope.run(() => useNavbarResize())
  if (!api) throw new Error('scope.run returned undefined')
  return api
}

describe('useNavbarResize', () => {
  beforeEach(() => {
    setViewportWidth(1440)
  })

  it('広いビューポートでは既定幅で開いた状態から始まる', () => {
    const { navWidth, navCollapsed } = setup()
    expect(navWidth.value).toBe(250)
    expect(navCollapsed.value).toBe(false)
  })

  it('狭いビューポートでは畳んだ状態から始まる', () => {
    setViewportWidth(1000)
    const { navCollapsed } = setup()
    expect(navCollapsed.value).toBe(true)
  })

  it('自分で畳んだあとスマホサイズにして元に戻しても畳んだままになる', () => {
    const { navCollapsed, toggleNav, handleResize } = setup()
    toggleNav()
    expect(navCollapsed.value).toBe(true)

    setViewportWidth(420)
    handleResize()
    expect(navCollapsed.value).toBe(true)

    setViewportWidth(1440)
    handleResize()
    expect(navCollapsed.value).toBe(true)
  })

  it('自分で開いた状態はスマホサイズを往復しても保たれる', () => {
    setViewportWidth(1000)
    const { navWidth, toggleNav, handleResize } = setup()
    toggleNav()
    expect(navWidth.value).toBe(250)

    setViewportWidth(420)
    handleResize()
    expect(navWidth.value).toBe(80)

    setViewportWidth(1440)
    handleResize()
    expect(navWidth.value).toBe(250)
  })

  it('ドラッグで決めた幅はスマホサイズを往復しても復元される', () => {
    const { navWidth, setNavWidth, handleResize } = setup()
    setNavWidth(320)

    setViewportWidth(420)
    handleResize()
    expect(navWidth.value).toBe(80)

    setViewportWidth(1440)
    handleResize()
    expect(navWidth.value).toBe(320)
  })
})

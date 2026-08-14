import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const settingsData: Record<string, unknown> = {}
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    get: (key: string) => settingsData[key],
    set: (key: string, value: unknown) => {
      settingsData[key] = value
    },
  }),
}))

const { useNavbarResize } = await import('./useNavbarResize')

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

/** ドラッグでナビバーの右端を x px まで動かして離す */
async function drag(
  startResize: (e: PointerEvent) => void,
  x: number,
): Promise<void> {
  startResize(new Event('pointerdown') as PointerEvent)
  document.dispatchEvent(
    Object.assign(new Event('pointermove'), { clientX: x }),
  )
  await new Promise((resolve) => requestAnimationFrame(resolve))
  document.dispatchEvent(new Event('pointerup'))
}

describe('useNavbarResize', () => {
  beforeEach(() => {
    for (const key of Object.keys(settingsData)) delete settingsData[key]
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

  it('ドラッグで決めた幅はスマホサイズを往復しても復元される', async () => {
    const { navWidth, startResize, handleResize } = setup()
    await drag(startResize, 320)
    expect(navWidth.value).toBe(320)

    setViewportWidth(420)
    handleResize()
    expect(navWidth.value).toBe(80)

    setViewportWidth(1440)
    handleResize()
    expect(navWidth.value).toBe(320)
  })

  describe('永続化', () => {
    it('トグルで畳んだ状態は次回起動時に復元される', () => {
      setup().toggleNav()
      expect(settingsData['deck.navWidth']).toBe(80)

      expect(setup().navCollapsed.value).toBe(true)
    })

    it('ドラッグで決めた幅は次回起動時に復元される', async () => {
      await drag(setup().startResize, 320)
      expect(settingsData['deck.navWidth']).toBe(320)

      expect(setup().navWidth.value).toBe(320)
    })

    it('最後の pointermove と同じフレームで離しても最終位置が保存される', () => {
      const { navWidth, startResize } = setup()
      startResize(new Event('pointerdown') as PointerEvent)
      document.dispatchEvent(
        Object.assign(new Event('pointermove'), { clientX: 320 }),
      )
      // frame を待たずに離す (実機のドラッグ終了で起きる順序)
      document.dispatchEvent(new Event('pointerup'))

      expect(navWidth.value).toBe(320)
      expect(settingsData['deck.navWidth']).toBe(320)
    })

    it('保存済みの幅は狭いビューポートで起動しても失われない', () => {
      settingsData['deck.navWidth'] = 320
      setViewportWidth(1000)
      const { navWidth, handleResize } = setup()
      expect(navWidth.value).toBe(80)

      setViewportWidth(1440)
      handleResize()
      expect(navWidth.value).toBe(320)
    })

    it('手編集された範囲外の値は許容範囲に丸める', () => {
      settingsData['deck.navWidth'] = 9999
      expect(setup().navWidth.value).toBe(400)

      settingsData['deck.navWidth'] = 10
      expect(setup().navWidth.value).toBe(80)
    })

    it('数値でない値は既定幅として扱う', () => {
      settingsData['deck.navWidth'] = 'wide'
      expect(setup().navWidth.value).toBe(250)
    })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h } from 'vue'
import type { useHoverPopup as UseHoverPopup } from './useHoverPopup'

type Popup = ReturnType<typeof UseHoverPopup>

let app: App | null = null

/** ポインタ環境を差し替える。coarse = 主ポインタがタッチ */
function stubPointerEnv(coarse: boolean, maxTouchPoints: number) {
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  })
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('coarse') ? coarse : !coarse,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia
}

// グローバルシングルトンを持つので、テストごとにモジュールを読み直す
async function mountHoverPopup(): Promise<Popup> {
  vi.resetModules()
  const { useHoverPopup } = await import('./useHoverPopup')
  let popup!: Popup
  app = createApp(
    defineComponent({
      setup() {
        popup = useHoverPopup({ showDelay: 0 })
        return () => h('div')
      },
    }),
  )
  app.mount(document.createElement('div'))
  return popup
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

afterEach(() => {
  app?.unmount()
  app = null
})

describe('useHoverPopup', () => {
  it('マウス環境ではポップアップを表示する', async () => {
    stubPointerEnv(false, 0)
    const popup = await mountHoverPopup()
    popup.show({ x: 10, y: 20 })
    await tick()
    expect(popup.isVisible.value).toBe(true)
    expect(popup.position.value).toEqual({ x: 10, y: 20 })
  })

  it('タッチスクリーン付き PC でもマウス操作ならポップアップを表示する (#914)', async () => {
    stubPointerEnv(false, 10)
    const popup = await mountHoverPopup()
    popup.show({ x: 10, y: 20 })
    await tick()
    expect(popup.isVisible.value).toBe(true)
  })

  it('主ポインタがタッチの端末ではポップアップを出さない', async () => {
    stubPointerEnv(true, 10)
    const popup = await mountHoverPopup()
    popup.show({ x: 10, y: 20 })
    await tick()
    expect(popup.isVisible.value).toBe(false)
  })
})

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent } from 'vue'
import { useUiStore } from '@/stores/ui'
import { BACKGROUND_GRACE_MS, useAppBackground } from './useAppBackground'

let apps: App[] = []
let pinia: ReturnType<typeof createPinia>

function mountHost() {
  const Host = defineComponent({
    setup() {
      useAppBackground()
      return () => null
    },
  })
  const app = createApp(Host)
  app.use(pinia)
  app.mount(document.createElement('div'))
  apps.push(app)
  return app
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    value: hidden,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useAppBackground: 離脱シグナルの発生源 (#986)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pinia = createPinia()
    setActivePinia(pinia)
    Object.defineProperty(document, 'hidden', {
      value: false,
      configurable: true,
    })
  })

  afterEach(() => {
    for (const app of apps) app.unmount()
    apps = []
    Reflect.deleteProperty(document, 'hidden')
    vi.useRealTimers()
  })

  it('隠れてから猶予を過ぎると background になる', () => {
    mountHost()
    const ui = useUiStore()
    setHidden(true)
    expect(ui.isBackground).toBe(false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS - 1)
    expect(ui.isBackground).toBe(false)
    vi.advanceTimersByTime(1)
    expect(ui.isBackground).toBe(true)
  })

  it('猶予中に戻れば background にならない (一瞬の最小化でフラップしない)', () => {
    mountHost()
    const ui = useUiStore()
    setHidden(true)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS / 2)
    setHidden(false)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    expect(ui.isBackground).toBe(false)
  })

  it('background から戻ると即座に foreground に戻る', () => {
    mountHost()
    const ui = useUiStore()
    setHidden(true)
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    expect(ui.isBackground).toBe(true)
    setHidden(false)
    expect(ui.isBackground).toBe(false)
  })

  it('unmount で background を解き、タイマーも残さない', () => {
    const app = mountHost()
    const ui = useUiStore()
    setHidden(true)
    app.unmount()
    apps = []
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS)
    expect(ui.isBackground).toBe(false)
  })
})

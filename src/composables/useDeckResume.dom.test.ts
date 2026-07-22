import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent } from 'vue'
import { useUiStore } from '@/stores/ui'
import { SLEEP_TICK_INTERVAL_MS } from '@/utils/sleepDetector'
import { useDeckResume } from './useDeckResume'

let apps: App[] = []
let pinia: ReturnType<typeof createPinia>

function mountHost() {
  const Host = defineComponent({
    setup() {
      useDeckResume()
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
}

describe('useDeckResume: 復帰シグナル発生源の一元管理 (#791)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'))
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    for (const app of apps) app.unmount()
    apps = []
    // defineProperty の上書きを原状復帰する
    Reflect.deleteProperty(document, 'hidden')
    vi.useRealTimers()
  })

  it('可視化 (visibilitychange) で発火し、hidden 化では発火しない', () => {
    mountHost()
    const uiStore = useUiStore()

    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(uiStore.deckResumeSignal).toBe(0)

    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(uiStore.deckResumeSignal).toBe(1)
  })

  it('Android ネイティブ復帰 (nd-app-resumed) で発火する', () => {
    mountHost()
    const uiStore = useUiStore()

    window.dispatchEvent(new Event('nd-app-resumed'))
    expect(uiStore.deckResumeSignal).toBe(1)
  })

  it('OS スリープ相当の時刻ジャンプで発火する (可視時のみ)', () => {
    mountHost()
    const uiStore = useUiStore()

    // 通常 tick では発火しない
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS * 2)
    expect(uiStore.deckResumeSignal).toBe(0)

    // hidden 中のジャンプは可視化時の visibilitychange に任せる
    setHidden(true)
    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000)
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS)
    expect(uiStore.deckResumeSignal).toBe(0)

    // 可視のままのスリープ復帰 = 時刻ジャンプ検知が唯一の経路
    setHidden(false)
    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000)
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS)
    expect(uiStore.deckResumeSignal).toBe(1)
  })

  it('unmount 後はどの経路でも発火しない', () => {
    const app = mountHost()
    const uiStore = useUiStore()
    app.unmount()
    apps = []

    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('nd-app-resumed'))
    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000)
    vi.advanceTimersByTime(SLEEP_TICK_INTERVAL_MS)
    expect(uiStore.deckResumeSignal).toBe(0)
  })
})

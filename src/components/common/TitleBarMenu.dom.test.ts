import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, h, nextTick, ref } from 'vue'
import { useCommandStore } from '@/commands/registry'
import { useWindowsStore } from '@/stores/windows'
import { WINDOW_LABELS } from '@/windows/registry'
import TitleBarMenu from './TitleBarMenu.vue'

/**
 * アプリの設定の入口はハンバーガーメニューに置く (ボトムバーの右端は知らせだけ)。
 * コマンドパレットへ飛ばさず、メニューの中で設定の種類を選んでそのウィンドウを開く
 */

vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: vi.fn().mockResolvedValue(false),
  enable: vi.fn(),
  disable: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))

const buttonWith = (text: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text,
  )

let app: App | null = null
let container: HTMLElement | null = null

async function mountOpened() {
  container = document.createElement('div')
  document.body.appendChild(container)
  const menu = ref<{ toggleMenu: () => void } | null>(null)
  app = createApp({ render: () => h(TitleBarMenu, { ref: menu }) })
  app.mount(container)
  menu.value?.toggleMenu()
  await nextTick()
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('TitleBarMenu の設定', () => {
  it('最上段の「設定」を開くと設定の種類が並び、選ぶとそのウィンドウを開いてメニューを閉じる', async () => {
    await mountOpened()
    const open = vi
      .spyOn(useWindowsStore(), 'open')
      .mockImplementation(() => 'win-1')
    const openPalette = vi.spyOn(useCommandStore(), 'openWithInput')

    const first = document.querySelector<HTMLButtonElement>('button._popupItem')
    expect(first?.textContent?.trim()).toBe('設定')
    first?.click()
    await nextTick()

    // 並びの定義元は SETTINGS_SECTIONS (コマンドパレットの設定の一覧と同じ)
    const label = WINDOW_LABELS.appearanceEditor ?? ''
    expect(label).not.toBe('')
    const appearance = buttonWith(label)
    expect(appearance).toBeDefined()
    appearance?.click()
    await nextTick()

    expect(open).toHaveBeenCalledWith('appearanceEditor')
    expect(openPalette).not.toHaveBeenCalled()
    // 閉じたので、設定の種類はもう押せない
    expect(buttonWith(label)).toBeUndefined()
  })
})

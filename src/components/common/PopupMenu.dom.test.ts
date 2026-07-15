import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h, nextTick, ref } from 'vue'
import PopupMenu from './PopupMenu.vue'

describe('PopupMenu: compact レイアウトでボトムシート表示 (#764)', () => {
  let app: App | null = null
  let container: HTMLElement | null = null

  afterEach(() => {
    app?.unmount()
    app = null
    container?.remove()
    container = null
  })

  // テストハーネス: ref 経由の命令的 open() が必要なため h() で最小構成を組む
  // (アプリ本体の Vapor 制約はテストコードには適用しない)
  function mountMenu(viewportWidth: number, onClose?: () => void) {
    // useUiStore は store 初期化時に innerWidth を読むため、pinia 作成前に設定する
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: viewportWidth,
    })
    const pinia = createPinia()
    setActivePinia(pinia)

    const menuRef = ref<InstanceType<typeof PopupMenu> | null>(null)
    const Parent = defineComponent({
      setup() {
        return () =>
          h(
            PopupMenu,
            { ref: menuRef, onClose },
            { default: () => h('button', null, 'アイテム') },
          )
      },
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    app = createApp(Parent)
    app.use(pinia)
    app.mount(container)
    return menuRef
  }

  function openEvent() {
    return new MouseEvent('click', { clientX: 100, clientY: 50 })
  }

  it('狭いビューポートでは座標配置されないシートとしてネスト描画される', async () => {
    const menuRef = mountMenu(375)
    menuRef.value?.open(openEvent())
    await nextTick()

    const root = container?.querySelector('[popover]') as HTMLElement
    expect(root).toBeTruthy()
    // シート branch: root は backdrop で、押下点への座標配置をしない
    expect(root.style.top).toBe('')
    expect(root.style.left).toBe('')
    // メニュー本体は backdrop の子としてネストされる
    const sheet = root.querySelector('.popup-menu')
    expect(sheet).toBeTruthy()
    expect(sheet?.textContent).toContain('アイテム')
  })

  it('広いビューポートでは従来どおり押下点にアンカーされる', async () => {
    const menuRef = mountMenu(1280)
    menuRef.value?.open(openEvent())
    await nextTick()

    const root = container?.querySelector('[popover]') as HTMLElement
    expect(root).toBeTruthy()
    // popup branch: root 自身がメニューで、clientX+4 / clientY+10 に配置
    expect(root.classList.contains('popup-menu')).toBe(true)
    expect(root.style.left).toBe('104px')
    expect(root.style.top).toBe('60px')
  })

  it('シートの backdrop タップで閉じ、メニュー項目タップでは閉じない', async () => {
    const onClose = vi.fn()
    const menuRef = mountMenu(375, onClose)
    menuRef.value?.open(openEvent())
    await nextTick()

    const root = container?.querySelector('[popover]') as HTMLElement
    const item = root.querySelector('button') as HTMLElement

    // 項目タップ (click.self 不成立) では閉じない
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()

    // backdrop 自身のタップで閉じる
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

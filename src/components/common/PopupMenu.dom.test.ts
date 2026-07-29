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
    // happy-dom はレイアウトを持たず clientWidth/Height が 0 になるため、
    // はみ出し補正が常に発火しないよう明示する
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: viewportWidth,
    })
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 800,
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

  // 位置確定は popover 表示後 (nextTick → rAF) なので両方待つ
  async function flushPosition() {
    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  }

  /** カラム外に置いたトリガーボタン (rect をモック) から open させる */
  function mountTrigger(
    menuRef: ReturnType<typeof mountMenu>,
    rect: Partial<DOMRect>,
  ) {
    const trigger = document.createElement('button')
    trigger.getBoundingClientRect = () => rect as DOMRect
    document.body.appendChild(trigger)
    const handler = (e: Event) => menuRef.value?.open(e as MouseEvent)
    trigger.addEventListener('click', handler)
    trigger.addEventListener('contextmenu', handler)
    return trigger
  }

  it('狭いビューポートでは設定メニューと同じ dialog ホストのシートとして描画される', async () => {
    const menuRef = mountMenu(375)
    menuRef.value?.open(openEvent())
    await nextTick()

    // シート branch: dialog._nativeDialog ホスト (::backdrop の暗転を共有)
    const dialog = container?.querySelector(
      'dialog._nativeDialog',
    ) as HTMLDialogElement
    expect(dialog).toBeTruthy()
    // メニュー本体は dialog の子としてネストされ、押下点への座標配置をしない
    const sheet = dialog.querySelector('.popup-menu') as HTMLElement
    expect(sheet).toBeTruthy()
    expect(sheet.style.top).toBe('')
    expect(sheet.textContent).toContain('アイテム')
    // popover 用の座標アンカー版は描画されない
    expect(container?.querySelector('[popover]')).toBeNull()
  })

  it('広いビューポートでは従来どおり押下点にアンカーされる', async () => {
    const menuRef = mountMenu(1280)
    menuRef.value?.open(openEvent())
    await flushPosition()

    const root = container?.querySelector('[popover]') as HTMLElement
    expect(root).toBeTruthy()
    // popup branch: root 自身がメニューで、clientX+4 / clientY+10 に配置
    expect(root.classList.contains('popup-menu')).toBe(true)
    expect(root.style.left).toBe('104px')
    expect(root.style.top).toBe('60px')
    expect(container?.querySelector('dialog')).toBeNull()
  })

  it('ボタン押下時は本家と同じくボタンの水平中央揃え + 直下に開く', async () => {
    const menuRef = mountMenu(1280)
    const trigger = mountTrigger(menuRef, {
      left: 400,
      right: 424,
      top: 100,
      bottom: 124,
      width: 24,
      height: 24,
    })

    trigger.dispatchEvent(
      new MouseEvent('click', { clientX: 410, clientY: 110, bubbles: true }),
    )
    await flushPosition()

    const root = container?.querySelector('[popover]') as HTMLElement
    // ボタン中央 (400 + 24/2 = 412) - メニュー幅/2 (テスト環境では 0)
    expect(root.style.left).toBe('412px')
    // ボタン直下
    expect(root.style.top).toBe('124px')

    trigger.remove()
  })

  it('右クリック時は本家と同じく押下点を左上頂点にする', async () => {
    const menuRef = mountMenu(1280)
    const trigger = mountTrigger(menuRef, {
      left: 400,
      right: 424,
      top: 100,
      bottom: 124,
      width: 24,
      height: 24,
    })

    trigger.dispatchEvent(
      new MouseEvent('contextmenu', {
        clientX: 100,
        clientY: 50,
        bubbles: true,
      }),
    )
    await flushPosition()

    const root = container?.querySelector('[popover]') as HTMLElement
    // トリガー要素ではなく押下点が基準
    expect(root.style.left).toBe('104px')
    expect(root.style.top).toBe('60px')

    trigger.remove()
  })

  it('シートの backdrop タップで閉じ、メニュー項目タップでは閉じない', async () => {
    const onClose = vi.fn()
    const menuRef = mountMenu(375, onClose)
    menuRef.value?.open(openEvent())
    await nextTick()

    const dialog = container?.querySelector(
      'dialog._nativeDialog',
    ) as HTMLDialogElement
    const item = dialog.querySelector('button') as HTMLElement

    // 項目タップ (target が dialog 自身でない) では閉じない
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()

    // backdrop タップ (target === dialog) で閉じる
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

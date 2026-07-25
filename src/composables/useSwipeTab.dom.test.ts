import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, nextTick, ref } from 'vue'
import { useSwipeTab } from './useSwipeTab'

vi.mock('@/utils/haptics', () => ({
  hapticLight: vi.fn(),
}))

let apps: App[] = []
let pinia: ReturnType<typeof createPinia>

interface Host {
  note: HTMLElement
  overlayChild: HTMLElement
  onSwipeLeft: ReturnType<typeof vi.fn>
  onSwipeRight: ReturnType<typeof vi.fn>
}

/**
 * カラムのスワイプ対象（TL では pull-to-refresh と同じスクローラ）の中に、
 * ノート → dialog (絵文字ピッカー) がネストした DOM を組む。
 * showModal() は DOM 位置を変えないため、実機でもこの入れ子のまま bubble する。
 */
async function mountHost(): Promise<Host> {
  const target = document.createElement('div')
  const note = document.createElement('div')
  const dialog = document.createElement('dialog')
  const overlayChild = document.createElement('button')
  dialog.appendChild(overlayChild)
  note.appendChild(dialog)
  target.appendChild(note)
  document.body.appendChild(target)

  const onSwipeLeft = vi.fn(() => true)
  const onSwipeRight = vi.fn(() => true)
  const targetRef = ref<HTMLElement | null>(null)

  const HostComponent = defineComponent({
    setup() {
      useSwipeTab(targetRef, onSwipeLeft, onSwipeRight)
      return () => null
    },
  })
  const app = createApp(HostComponent)
  app.use(pinia)
  app.mount(document.createElement('div'))
  apps.push(app)

  // 本番同様、マウント後に ref へ代入してリスナーを bind させる
  targetRef.value = target
  await nextTick()

  return { note, overlayChild, onSwipeLeft, onSwipeRight }
}

function touch(type: string, clientX: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const list = [{ clientX, clientY: 0 }]
  Object.defineProperty(e, 'touches', {
    value: type === 'touchend' ? [] : list,
  })
  Object.defineProperty(e, 'changedTouches', { value: list })
  return e
}

/** 指定要素から左方向にスワイプする（タブ切替が発火する向き） */
function swipeLeft(target: HTMLElement) {
  target.dispatchEvent(touch('touchstart', 300))
  target.dispatchEvent(touch('touchmove', 100))
  target.dispatchEvent(touch('touchend', 100))
}

describe('useSwipeTab: ネストしたオーバーレイからの誤発火 (#811)', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    for (const app of apps) app.unmount()
    apps = []
    document.body.innerHTML = ''
  })

  it('スワイプ対象内のノートを横に払うとタブが切り替わる', async () => {
    const { note, onSwipeLeft } = await mountHost()
    swipeLeft(note)
    expect(onSwipeLeft).toHaveBeenCalled()
  })

  it('ネストした dialog (絵文字ピッカー) 内の横ドラッグではタブが切り替わらない', async () => {
    const { overlayChild, onSwipeLeft, onSwipeRight } = await mountHost()
    swipeLeft(overlayChild)
    expect(onSwipeLeft).not.toHaveBeenCalled()
    expect(onSwipeRight).not.toHaveBeenCalled()
  })
})

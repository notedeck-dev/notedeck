import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, nextTick, ref } from 'vue'
import { usePullToRefresh } from './usePullToRefresh'

vi.mock('@/utils/haptics', () => ({
  hapticMedium: vi.fn(),
}))

let apps: App[] = []
let pinia: ReturnType<typeof createPinia>

interface Host {
  scroller: HTMLElement
  note: HTMLElement
  overlayChild: HTMLElement
  state: ReturnType<typeof usePullToRefresh>
  refresh: ReturnType<typeof vi.fn>
}

/**
 * TL カラムのスクローラ内に、ノート → dialog (絵文字ピッカー) がネストした DOM を組む。
 * showModal() は DOM 位置を変えないため、実機でもこの入れ子のままイベントが bubble する。
 */
async function mountHost(): Promise<Host> {
  const scroller = document.createElement('div')
  const note = document.createElement('div')
  const dialog = document.createElement('dialog')
  const overlayChild = document.createElement('button')
  dialog.appendChild(overlayChild)
  note.appendChild(dialog)
  scroller.appendChild(note)
  document.body.appendChild(scroller)

  const refresh = vi.fn(() => Promise.resolve())
  const scrollerRef = ref<HTMLElement | null>(null)
  let state!: ReturnType<typeof usePullToRefresh>

  const HostComponent = defineComponent({
    setup() {
      state = usePullToRefresh(scrollerRef, refresh)
      return () => null
    },
  })
  const app = createApp(HostComponent)
  app.use(pinia)
  app.mount(document.createElement('div'))
  apps.push(app)

  // 本番同様、マウント後に ref へ代入してリスナーを bind させる
  scrollerRef.value = scroller
  await nextTick()

  return { scroller, note, overlayChild, state, refresh }
}

function touch(type: string, screenY: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', {
    value: [{ screenX: 0, screenY }],
  })
  return e
}

/** 指定要素から下方向にドラッグする（PTR が発火する向き） */
function dragDown(target: HTMLElement) {
  target.dispatchEvent(touch('touchstart', 0))
  target.dispatchEvent(touch('touchmove', 120))
}

describe('usePullToRefresh: ネストしたオーバーレイからの誤発火 (#810)', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    for (const app of apps) app.unmount()
    apps = []
    document.body.innerHTML = ''
  })

  it('スクローラ内のノートを下に引くと pull する', async () => {
    const { note, state } = await mountHost()
    dragDown(note)
    expect(state.isPulling.value).toBe(true)
    expect(state.pullDistance.value).toBe(120)
  })

  it('スクローラ内にネストした dialog (絵文字ピッカー) 内のドラッグでは pull しない', async () => {
    const { overlayChild, state } = await mountHost()
    dragDown(overlayChild)
    expect(state.isPulling.value).toBe(false)
    expect(state.pullDistance.value).toBe(0)
  })

  it('スクローラ自身を包む dialog（ウィンドウ表示のカラム）では pull を止めない', async () => {
    const { scroller, note, state } = await mountHost()
    const wrapper = document.createElement('dialog')
    document.body.appendChild(wrapper)
    wrapper.appendChild(scroller)

    dragDown(note)
    expect(state.isPulling.value).toBe(true)
    expect(state.pullDistance.value).toBe(120)
  })
})

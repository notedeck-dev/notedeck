// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useMainStreamKeeper } from './useMainStreamKeeper'

/**
 * 通知を配る main チャンネルは口座セッションが全口座について張る (#330 §3.1)。
 * 起動時は Rust が張るので、フロントは復帰 (スリープ復帰 / オフライン解除) の
 * 信号で張り直しを 1 本だけ頼む。
 */

const { streamSubscribeMainAll } = vi.hoisted(() => ({
  streamSubscribeMainAll: vi.fn(() =>
    Promise.resolve({ status: 'ok' as const, data: [] as string[] }),
  ),
}))

vi.mock('@/bindings', () => ({
  commands: { streamSubscribeMainAll },
}))

describe('useMainStreamKeeper', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    streamSubscribeMainAll.mockClear()
  })

  it('復帰の信号ごとに全口座の main を張り直す (マウント時は頼まない)', async () => {
    const Host = defineComponent({
      setup() {
        useMainStreamKeeper()
        return () => null
      },
    })
    const app = createApp(Host)
    app.mount(document.createElement('div'))
    await nextTick()
    expect(streamSubscribeMainAll).not.toHaveBeenCalled()

    useUiStore().emitDeckResume()
    await nextTick()
    expect(streamSubscribeMainAll).toHaveBeenCalledTimes(1)

    useUiStore().emitDeckResume()
    await nextTick()
    expect(streamSubscribeMainAll).toHaveBeenCalledTimes(2)
    app.unmount()
  })
})

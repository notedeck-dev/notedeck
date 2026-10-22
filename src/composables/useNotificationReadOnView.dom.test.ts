// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick } from 'vue'
import { useNotificationReadOnView } from './useNotificationReadOnView'

/**
 * 既読は「見たとき」だけ (#330 §3.2)。通知カラムが可視 (viewport 内 + ウィンドウに
 * フォーカス) になったら取得で既読にし、可視のまま届いた新着は WS で既読にする。
 * 見ていない間は何も送らない。
 */

const { apiReadNotificationsOnView, streamReadNotifications } = vi.hoisted(
  () => ({
    apiReadNotificationsOnView: vi.fn((_accountId: string) =>
      Promise.resolve({ status: 'ok' as const, data: null }),
    ),
    streamReadNotifications: vi.fn((_accountId: string) =>
      Promise.resolve({ status: 'ok' as const, data: null }),
    ),
  }),
)

vi.mock('@/bindings', () => ({
  commands: { apiReadNotificationsOnView, streamReadNotifications },
}))

function mountWith(getAccountIds: () => string[]) {
  let api!: ReturnType<typeof useNotificationReadOnView>
  const Host = defineComponent({
    setup() {
      api = useNotificationReadOnView('col-1', getAccountIds)
      return () => null
    },
  })
  const app = createApp(Host)
  app.mount(document.createElement('div'))
  return { api, unmount: () => app.unmount() }
}

function setFocus(focused: boolean) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
  window.dispatchEvent(new Event(focused ? 'focus' : 'blur'))
}

describe('useNotificationReadOnView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiReadNotificationsOnView.mockClear()
    streamReadNotifications.mockClear()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  it('可視でフォーカスがあればマウント時に口座ごとに取得で既読にする', async () => {
    const { unmount } = mountWith(() => ['a', 'b'])
    await nextTick()
    expect(apiReadNotificationsOnView.mock.calls.map((c) => c[0])).toEqual([
      'a',
      'b',
    ])
    unmount()
  })

  it('フォーカスが無ければ既読にせず、フォーカスが戻ったときに既読にする', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const { unmount } = mountWith(() => ['a'])
    await nextTick()
    expect(apiReadNotificationsOnView).not.toHaveBeenCalled()

    setFocus(true)
    await nextTick()
    expect(apiReadNotificationsOnView).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('可視のまま届いた新着は WS で既読にし、見ていない間は何も送らない', async () => {
    const { api, unmount } = mountWith(() => ['a'])
    await nextTick()
    api.onArrival('a')
    expect(streamReadNotifications).toHaveBeenCalledWith('a')

    setFocus(false)
    await nextTick()
    api.onArrival('a')
    expect(streamReadNotifications).toHaveBeenCalledTimes(1)
    unmount()
  })
})

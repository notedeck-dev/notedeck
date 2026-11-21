// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Microsoft Store 版 (#849): 通知プラグインが名乗る識別子では出せないので、Rust 側の経路で出す。
// 配布の形態の答えは起動直後には届いていないので、届くまで待ってから経路を選ぶ
const appDistribution = vi.fn()
const showOsNotification = vi.fn(async () => undefined)
const sendNotification = vi.fn()

vi.mock('@/bindings', () => ({
  commands: { appDistribution, showOsNotification },
}))
vi.mock('@/utils/settingsFs', () => ({ isTauri: true }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => 'granted'),
  onAction: vi.fn(async () => undefined),
  sendNotification,
}))

async function load() {
  vi.resetModules()
  const mod = await import('@/utils/desktopNotification')
  await mod.initDesktopNotifications()
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  return mod
}

describe('desktopNotification: 配布の形態で経路を選ぶ', () => {
  beforeEach(() => {
    appDistribution.mockReset()
    showOsNotification.mockClear()
    sendNotification.mockClear()
  })

  it('Microsoft Store 版は、答えが届く前に送った通知も Rust 側の経路で出す', async () => {
    let answer: (d: string) => void = () => undefined
    appDistribution.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { sendDesktopNotification } = await load()
    sendDesktopNotification('title', 'body', { accountId: 'a', noteId: 'n' })
    // 答えが届くまではどちらにも送らない (プラグインへ先走らない)
    expect(sendNotification).not.toHaveBeenCalled()
    expect(showOsNotification).not.toHaveBeenCalled()

    answer('microsoftStore')
    await vi.waitFor(() => expect(showOsNotification).toHaveBeenCalledTimes(1))
    expect(showOsNotification).toHaveBeenCalledWith('title', 'body', {
      accountId: 'a',
      noteId: 'n',
      userId: null,
    })
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('直接配布版は、今までどおり通知プラグインで出す', async () => {
    appDistribution.mockResolvedValue('direct')
    const { sendDesktopNotification } = await load()
    sendDesktopNotification('title', 'body')
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1))
    expect(showOsNotification).not.toHaveBeenCalled()
  })

  it('形態を聞けなかったときは、通知プラグインで出す', async () => {
    appDistribution.mockRejectedValue(new Error('ipc failed'))
    const { sendDesktopNotification } = await load()
    sendDesktopNotification('title', 'body')
    await vi.waitFor(() => expect(sendNotification).toHaveBeenCalledTimes(1))
    expect(showOsNotification).not.toHaveBeenCalled()
  })
})

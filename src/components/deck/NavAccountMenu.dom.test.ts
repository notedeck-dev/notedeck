import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, h, nextTick } from 'vue'
import type { Account } from '@/stores/accounts'
import NavAccountMenu from './NavAccountMenu.vue'

/**
 * アカウントメニューの「閉じている間の通知」の行 (#330)。メニューは開くたびに v-if で
 * 作られ、show は最初から true で渡される。開いた時点で push と OS の通知の許可を
 * 読まないと、行が押せる行にならず登録の窓へ進めない (v1.94.0 / v1.95.0 の不具合)
 */

const ok = <T>(data: T) => Promise.resolve({ status: 'ok' as const, data })

const { pushStatus, notificationPermissionGranted } = vi.hoisted(() => ({
  pushStatus: vi.fn(),
  notificationPermissionGranted: vi.fn(),
}))

vi.mock('@/bindings', () => ({
  commands: { pushStatus, notificationPermissionGranted },
}))

// 端末の判定はモジュールの読込時に決まるので、Android として振る舞う店に差し替える
vi.mock('@/stores/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/ui')>()
  return {
    ...original,
    useUiStore: () => ({ ...original.useUiStore(), isMobilePlatform: true }),
  }
})

const account: Account = {
  id: 'acct-1',
  host: 'misskey.example',
  userId: 'u1',
  username: 'alice',
  displayName: null,
  avatarUrl: null,
  software: 'misskey-dev/misskey',
  hasToken: true,
}

let app: App | null = null
let container: HTMLElement | null = null

function mountMenu() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () =>
      h(NavAccountMenu, {
        show: true,
        account,
        modes: {},
        togglingMode: false,
        modeError: null,
        isAdmin: false,
      }),
  })
  app.use(createPinia())
  app.mount(container)
}

async function flush() {
  for (let i = 0; i < 3; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  pushStatus.mockReset()
  notificationPermissionGranted.mockReset()
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('NavAccountMenu の閉じている間の通知', () => {
  it('開いた時点で push の状態を読み、状態行を押せる行にする', async () => {
    pushStatus.mockImplementation(() => ok('off'))
    notificationPermissionGranted.mockResolvedValue(true)
    mountMenu()
    await flush()
    expect(pushStatus).toHaveBeenCalledWith('acct-1')
    const row = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('閉じている間の通知'),
    )
    expect(row).toBeDefined()
  })

  it('開いた時点で OS の通知の許可を読み、拒否なら設定への導線を出す', async () => {
    pushStatus.mockImplementation(() => ok('off'))
    notificationPermissionGranted.mockResolvedValue(false)
    mountMenu()
    await flush()
    expect(notificationPermissionGranted).toHaveBeenCalled()
    const settings = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('OS の通知設定を開く'),
    )
    expect(settings).toBeDefined()
  })
})

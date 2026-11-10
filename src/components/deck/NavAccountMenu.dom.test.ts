import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, h, nextTick } from 'vue'
import type { Account } from '@/stores/accounts'
import NavAccountMenu from './NavAccountMenu.vue'

/**
 * アカウントメニューの通知まわり (#330)。push の設定は端末で 1 つなので設定メニューに置き、
 * アカウントメニューには出さない。OS の通知の許可は、メニューは開くたびに v-if で作られ
 * show が最初から true で渡されるので、開いた時点で読む (v1.94.0 / v1.95.0 の不具合)
 */

const { notificationPermissionGranted } = vi.hoisted(() => ({
  notificationPermissionGranted: vi.fn(),
}))

vi.mock('@/bindings', () => ({
  commands: { notificationPermissionGranted },
}))

const { openSafeUrl } = vi.hoisted(() => ({ openSafeUrl: vi.fn() }))
vi.mock('@/utils/url', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/url')>()),
  openSafeUrl,
}))

const buttonWith = (text: string) =>
  [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text),
  )

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

function mountMenu(target: Account = account) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () =>
      h(NavAccountMenu, {
        show: true,
        account: target,
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
  notificationPermissionGranted.mockReset()
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('NavAccountMenu の通知まわり', () => {
  it('push の項目は出さない (設定メニューにある)', async () => {
    notificationPermissionGranted.mockResolvedValue(true)
    mountMenu()
    await flush()
    expect(buttonWith('プッシュ通知')).toBeUndefined()
    expect(buttonWith('OS の通知設定を開く')).toBeUndefined()
  })

  it('開いた時点で OS の通知の許可を読み、拒否なら設定への導線を出す', async () => {
    notificationPermissionGranted.mockResolvedValue(false)
    mountMenu()
    await flush()
    expect(notificationPermissionGranted).toHaveBeenCalled()
    expect(buttonWith('OS の通知設定を開く')).toBeDefined()
  })
})

/**
 * ミュート / ブロックの一覧は本体に持たず、本家 Web の該当ページへ直接送る (#1267)。
 * パスを確かめてあるのは対応しているソフトウェアだけ
 */
describe('NavAccountMenu のミュートとブロック', () => {
  it('本家 Web のミュートとブロックのページを直接開く', async () => {
    notificationPermissionGranted.mockResolvedValue(true)
    mountMenu()
    await flush()
    buttonWith('ミュートとブロック')?.click()
    expect(openSafeUrl).toHaveBeenCalledWith(
      'https://misskey.example/settings/mute-block',
    )
  })

  it('対応していないソフトウェアでは出さない', async () => {
    notificationPermissionGranted.mockResolvedValue(true)
    mountMenu({ ...account, software: 'iceshrimp/iceshrimp' })
    await flush()
    expect(buttonWith('ミュートとブロック')).toBeUndefined()
  })
})

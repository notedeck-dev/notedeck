import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h, nextTick } from 'vue'
import type { NoteGroup } from '@/services/noteGroup'

vi.mock('@/stores/accounts', () => ({
  useAccountsStore: () => ({ accountMap: new Map() }),
  getAccountLabel: () => 'acc',
  getAccountAvatarUrl: () => '',
}))
vi.mock('@/utils/mediaProxy', () => ({ proxyThumbUrl: () => '' }))
vi.mock('./AccountAvatar.vue', () => ({
  default: defineComponent({ setup: () => () => h('span') }),
}))

import NoteVariantsPopup from './NoteVariantsPopup.vue'

const group = {
  rowKey: 'g',
  primary: { id: 'n1', _accountId: 'a1', _serverHost: 'misskey.test' },
  variants: [{ id: 'n1', _accountId: 'a1', _serverHost: 'misskey.test' }],
  reactedBy: new Map(),
} as unknown as NoteGroup

let app: App | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  // happy-dom はレイアウトを持たないので、ポップの実寸と画面幅を固定する
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 300,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 100,
  })
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    get: () => 1024,
  })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => 768,
  })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})

afterEach(() => {
  app?.unmount()
  app = null
  container?.remove()
  container = null
  vi.unstubAllGlobals()
})

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(NoteVariantsPopup, { group })
  const vm = app.mount(container) as unknown as {
    open: (anchor: HTMLElement) => void
  }
  const trigger = document.createElement('button')
  trigger.getBoundingClientRect = () =>
    ({ left: 500, right: 600, top: 100, bottom: 120 }) as DOMRect
  return { vm, trigger }
}

function popupLeft(): string {
  const el = container?.querySelector('[role="dialog"]') as HTMLElement | null
  return el?.style.left ?? ''
}

describe('NoteVariantsPopup', () => {
  it('バッジで閉じるとき、退場中に位置が動かない', async () => {
    const { vm, trigger } = mount()
    vm.open(trigger)
    await nextTick()
    await nextTick()
    // 右端をバッジの右端 (600) に揃えて実寸 (300) ぶん左へ
    expect(popupLeft()).toBe('300px')

    vm.open(trigger)
    await nextTick()
    // 退場アニメの間も同じ場所に留まる (仮置きの 600 - 240 = 360 に戻らない)
    expect(popupLeft()).toBe('300px')
  })
})

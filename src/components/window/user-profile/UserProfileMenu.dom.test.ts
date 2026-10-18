// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h, nextTick } from 'vue'
import { useMutesStore } from '@/stores/mutes'
import { AppError } from '@/utils/errors'
import { formatMuteExpiry } from '@/utils/formatTime'

vi.mock('@/components/common/PopupMenu.vue', () => ({
  default: defineComponent({
    setup(_, { slots, expose }) {
      expose({ open: vi.fn(), close: vi.fn() })
      return () => h('div', { class: 'popup-stub' }, slots.default?.())
    },
  }),
}))

import UserProfileMenu from './UserProfileMenu.vue'

const NOW = new Date('2026-10-15T00:00:00.000Z').getTime()
const HOUR = 60 * 60 * 1000

let app: App | null = null
let container: HTMLElement | null = null
let vm: { open: (e: MouseEvent) => void } | null = null
const muteUser = vi.fn(async () => undefined)
const unmuteUser = vi.fn(async () => undefined)
const getUserRelations = vi.fn()

function relation(isMuted: boolean) {
  return {
    id: 'u1',
    isFollowing: false,
    isFollowed: false,
    isBlocking: false,
    isBlocked: false,
    isMuted,
    isRenoteMuted: false,
  }
}

async function mountMenu(opts: { isMuted?: boolean } = {}) {
  setActivePinia(createPinia())
  container = document.createElement('div')
  document.body.appendChild(container)
  getUserRelations.mockResolvedValue([relation(opts.isMuted ?? false)])
  const adapter = { api: { getUserRelations, muteUser, unmuteUser } }
  app = createApp(UserProfileMenu, {
    adapter,
    accountId: 'acc1',
    user: { id: 'u1', username: 'alice', host: null },
    hasToken: true,
    isOwnProfile: false,
  })
  vm = app.mount(container) as unknown as typeof vm
  await flush()
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll('button._popupItem') ?? [])
}

function labels(): string[] {
  return buttons().map((b) => b.textContent?.trim() ?? '')
}

async function click(label: string) {
  const btn = buttons().find((b) => b.textContent?.trim() === label)
  if (!btn) throw new Error(`no button: ${label}`)
  btn.click()
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  muteUser.mockReset().mockResolvedValue(undefined)
  unmuteUser.mockReset().mockResolvedValue(undefined)
  getUserRelations.mockReset()
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
  vm = null
  vi.useRealTimers()
})

describe('UserProfileMenu のミュート期間 (#1260)', () => {
  it('ミュートを押すと本家と同じ 5 つの期間を選べる', async () => {
    await mountMenu()
    await click('ミュート')
    expect(labels()).toEqual([
      '無期限',
      '10 分',
      '1 時間',
      '1 日',
      '1 週間',
      'キャンセル',
    ])
  })

  it('期間を選ぶとその時刻を期限にしてミュートし、手元の非表示も期限で戻る', async () => {
    await mountMenu()
    await click('ミュート')
    await click('1 時間')
    expect(muteUser).toHaveBeenCalledWith('u1', NOW + HOUR)
    const mutes = useMutesStore()
    expect(mutes.isUserMuted('acc1', 'u1')).toBe(true)
    vi.advanceTimersByTime(HOUR)
    expect(mutes.isUserMuted('acc1', 'u1')).toBe(false)
  })

  it('無期限は期限を付けない', async () => {
    await mountMenu()
    await click('ミュート')
    await click('無期限')
    expect(muteUser).toHaveBeenCalledWith('u1', undefined)
  })
})

describe('UserProfileMenu のミュート中の表示と失敗系 (#1260)', () => {
  it('期限つきでミュート中なら「ミュート解除」に期限を添える', async () => {
    await mountMenu({ isMuted: true })
    useMutesStore().muteUser('acc1', 'u1', NOW + HOUR)
    await flush()
    expect(labels()).toContain(
      `ミュート解除 (${formatMuteExpiry(NOW + HOUR)}まで)`,
    )
  })

  it('無期限 (期限が分からない) なら「ミュート解除」のまま', async () => {
    await mountMenu({ isMuted: true })
    expect(labels()).toContain('ミュート解除')
  })

  it('メニューを開くたびにミュート状態を取り直す', async () => {
    await mountMenu({ isMuted: false })
    expect(getUserRelations).toHaveBeenCalledTimes(1)
    getUserRelations.mockResolvedValue([relation(true)])
    vm?.open(new MouseEvent('click'))
    await flush()
    expect(getUserRelations).toHaveBeenCalledTimes(2)
    expect(labels()).toContain('ミュート解除')
  })

  it('解除でサーバーが NOT_MUTING を返したら成功として扱う', async () => {
    await mountMenu({ isMuted: true })
    useMutesStore().muteUser('acc1', 'u1')
    unmuteUser.mockRejectedValue(
      new AppError('API', 'not muting', 'NOT_MUTING'),
    )
    getUserRelations.mockResolvedValue([relation(false)])
    await click('ミュート解除')
    expect(useMutesStore().isUserMuted('acc1', 'u1')).toBe(false)
    expect(labels()).toContain('ミュート')
  })

  it('ミュートでサーバーが ALREADY_MUTING を返したら手元もミュート中にして表示を直す', async () => {
    await mountMenu({ isMuted: false })
    muteUser.mockRejectedValue(
      new AppError('API', 'already muting', 'ALREADY_MUTING'),
    )
    getUserRelations.mockResolvedValue([relation(true)])
    await click('ミュート')
    await click('無期限')
    expect(useMutesStore().isUserMuted('acc1', 'u1')).toBe(true)
    // 表示を直すために relation を取り直す (スタブの PopupMenu は閉じても
    // サブビューを戻さないので、ラベルではなく取り直しで検証する)
    expect(getUserRelations).toHaveBeenCalledTimes(2)
  })
})

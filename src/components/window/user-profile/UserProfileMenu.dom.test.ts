// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h, nextTick } from 'vue'
import { useMutesStore } from '@/stores/mutes'

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
const muteUser = vi.fn(async () => undefined)

async function mountMenu() {
  setActivePinia(createPinia())
  container = document.createElement('div')
  document.body.appendChild(container)
  const adapter = {
    api: {
      getUserRelations: vi.fn(async () => [
        {
          id: 'u1',
          isFollowing: false,
          isFollowed: false,
          isBlocking: false,
          isBlocked: false,
          isMuted: false,
          isRenoteMuted: false,
        },
      ]),
      muteUser,
    },
  }
  app = createApp(UserProfileMenu, {
    adapter,
    accountId: 'acc1',
    user: { id: 'u1', username: 'alice', host: null },
    hasToken: true,
    isOwnProfile: false,
  })
  app.mount(container)
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

async function click(label: string) {
  const btn = buttons().find((b) => b.textContent?.trim() === label)
  if (!btn) throw new Error(`no button: ${label}`)
  btn.click()
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  muteUser.mockClear()
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
  vi.useRealTimers()
})

describe('UserProfileMenu のミュート期間 (#1260)', () => {
  it('ミュートを押すと本家と同じ 5 つの期間を選べる', async () => {
    await mountMenu()
    await click('ミュート')
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([
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

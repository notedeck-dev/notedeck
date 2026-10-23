// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick } from 'vue'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useNotificationPermissionPrompt } from './useNotificationPermissionPrompt'

/**
 * 通知の権限は起動時ではなく、最初の口座を追加した直後に、仕組みの説明 1 画面を
 * 挟んで求める (#330 §4.5)。モバイルだけ。2 つ目以降の口座では求めない。
 */

const { requestNotificationPermission, confirm, ui } = vi.hoisted(() => ({
  requestNotificationPermission: vi.fn(() =>
    Promise.resolve({ status: 'ok' as const, data: null }),
  ),
  confirm: vi.fn(() => Promise.resolve(true)),
  ui: { isMobilePlatform: true },
}))

vi.mock('@/bindings', () => ({ commands: { requestNotificationPermission } }))
vi.mock('@/stores/confirm', () => ({ useConfirm: () => ({ confirm }) }))
vi.mock('@/stores/ui', () => ({ useUiStore: () => ui }))

function account(id: string, hasToken = true): Account {
  return {
    id,
    host: 'example.com',
    userId: `uid-${id}`,
    username: id,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken,
  } as Account
}

function mountPrompt() {
  const Host = defineComponent({
    setup() {
      useNotificationPermissionPrompt()
      return () => null
    },
  })
  const app = createApp(Host)
  app.mount(document.createElement('div'))
  return app
}

describe('useNotificationPermissionPrompt', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestNotificationPermission.mockClear()
    confirm.mockClear()
    ui.isMobilePlatform = true
  })

  it('最初の口座が追加されたら説明を出してから権限を求める', async () => {
    const accounts = useAccountsStore()
    mountPrompt()
    await nextTick()
    expect(confirm).not.toHaveBeenCalled()

    accounts.accounts.push(account('a'))
    await nextTick()
    await Promise.resolve()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(requestNotificationPermission).toHaveBeenCalledTimes(1)

    // 2 つ目の口座では求めない
    accounts.accounts.push(account('b'))
    await nextTick()
    await Promise.resolve()
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('起動時に口座が既にあれば求めない (初回ログインのときだけ)', async () => {
    const accounts = useAccountsStore()
    accounts.accounts.push(account('a'))
    mountPrompt()
    await nextTick()
    await Promise.resolve()
    expect(confirm).not.toHaveBeenCalled()
    expect(requestNotificationPermission).not.toHaveBeenCalled()
  })

  it('デスクトップでは何もしない', async () => {
    ui.isMobilePlatform = false
    const accounts = useAccountsStore()
    mountPrompt()
    accounts.accounts.push(account('a'))
    await nextTick()
    await Promise.resolve()
    expect(confirm).not.toHaveBeenCalled()
  })
})

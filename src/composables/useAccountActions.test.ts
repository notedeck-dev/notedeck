import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  accountsStore: { removeAccount: vi.fn(async () => undefined) },
  deckStore: {
    columns: [] as { id: string; accountId: string | null }[],
    removeColumn: vi.fn(),
    purgeAccountWidgets: vi.fn(),
  },
  streamingStore: { disconnect: vi.fn(), connect: vi.fn() },
  windowsStore: { open: vi.fn() },
  confirm: vi.fn(async () => true),
  toast: { show: vi.fn() },
  purgeNotificationCacheForAccount: vi.fn(),
}))

vi.mock('@/stores/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/accounts')>()),
  useAccountsStore: () => h.accountsStore,
}))
vi.mock('@/stores/deck', () => ({ useDeckStore: () => h.deckStore }))
vi.mock('@/stores/streaming', () => ({
  useStreamingStore: () => h.streamingStore,
}))
vi.mock('@/stores/windows', () => ({ useWindowsStore: () => h.windowsStore }))
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: h.confirm }),
}))
vi.mock('@/stores/toast', () => ({ useToast: () => h.toast }))
vi.mock('@/utils/notificationCache', () => ({
  purgeNotificationCacheForAccount: h.purgeNotificationCacheForAccount,
}))

import { type Account, accountScopeKey } from '@/stores/accounts'
import { useAccountActions } from './useAccountActions'

const acc = {
  id: 'uuid-yami',
  host: 'yami.ski',
  userId: 'u1',
  username: 'alice',
  hasToken: true,
} as Account

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  h.deckStore.columns = []
  h.accountsStore.removeAccount.mockResolvedValue(undefined)
  h.confirm.mockResolvedValue(true)
})

describe('アカウント削除でウィジェット個体を消す順序 (#1061)', () => {
  it('backend 削除が成功してからウィジェット個体を消す', async () => {
    const { deleteAccount } = useAccountActions()

    await deleteAccount(acc)
    await vi.waitFor(() =>
      expect(h.accountsStore.removeAccount).toHaveBeenCalled(),
    )

    expect(h.accountsStore.removeAccount).toHaveBeenCalledWith(acc.id)
    expect(h.deckStore.purgeAccountWidgets).toHaveBeenCalledWith(
      accountScopeKey(acc),
    )
    const removeOrder =
      h.accountsStore.removeAccount.mock.invocationCallOrder[0] ?? 0
    const purgeOrder =
      h.deckStore.purgeAccountWidgets.mock.invocationCallOrder[0] ?? 0
    expect(purgeOrder).toBeGreaterThan(removeOrder)
  })

  it('backend 削除が失敗したらウィジェット個体を消さない (ソースと Mk:save は不可逆)', async () => {
    h.accountsStore.removeAccount.mockRejectedValue(new Error('network'))
    const { deleteAccount } = useAccountActions()

    await deleteAccount(acc)
    await vi.waitFor(() => expect(h.toast.show).toHaveBeenCalled())

    expect(h.deckStore.purgeAccountWidgets).not.toHaveBeenCalled()
  })
})

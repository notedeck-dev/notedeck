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
  pluginsStore: { purgeAccount: vi.fn() },
  queriesStore: { purgeAccount: vi.fn() },
  themeStore: { purgeAccount: vi.fn() },
  vault: { purgeAccount: vi.fn(async () => undefined) },
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
vi.mock('@/stores/plugins', () => ({ usePluginsStore: () => h.pluginsStore }))
vi.mock('@/stores/columnQueries', () => ({
  useColumnQueriesStore: () => h.queriesStore,
}))
vi.mock('@/stores/theme', () => ({ useThemeStore: () => h.themeStore }))
vi.mock('@/composables/useVault', () => ({ useVault: () => h.vault }))

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
  h.vault.purgeAccount.mockResolvedValue(undefined)
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

describe('アカウント削除でカラムを閉じる順序 (#1091)', () => {
  const ownColumn = { id: 'col-own', accountId: acc.id }
  const otherColumn = { id: 'col-other', accountId: 'uuid-other' }
  const crossColumn = { id: 'col-cross', accountId: null }

  beforeEach(() => {
    h.deckStore.columns = [ownColumn, otherColumn, crossColumn]
  })

  it('backend 削除が成功してから、そのアカウントのカラムだけを閉じる', async () => {
    const { deleteAccount } = useAccountActions()

    await deleteAccount(acc)
    await vi.waitFor(() =>
      expect(h.deckStore.removeColumn).toHaveBeenCalledWith(ownColumn.id),
    )

    expect(h.deckStore.removeColumn).toHaveBeenCalledTimes(1)
    const removeAccountOrder =
      h.accountsStore.removeAccount.mock.invocationCallOrder[0] ?? 0
    const removeColumnOrder =
      h.deckStore.removeColumn.mock.invocationCallOrder[0] ?? 0
    expect(removeColumnOrder).toBeGreaterThan(removeAccountOrder)
  })

  it('backend 削除が失敗したらカラムを閉じない (アカウントが残るのにカラムだけ消えた状態を作らない)', async () => {
    h.accountsStore.removeAccount.mockRejectedValue(new Error('db locked'))
    const { deleteAccount } = useAccountActions()

    await deleteAccount(acc)
    await vi.waitFor(() => expect(h.toast.show).toHaveBeenCalled())

    expect(h.deckStore.removeColumn).not.toHaveBeenCalled()
  })
})

describe('アカウント削除でプラグイン・クエリ・テーマのスコープ参加を掃除する (#1114)', () => {
  it('backend 削除が成功したら安定キーで各 store の purge を呼ぶ', async () => {
    const actions = useAccountActions()
    await actions.deleteAccountData(acc)
    const key = accountScopeKey(acc)
    expect(h.pluginsStore.purgeAccount).toHaveBeenCalledWith(key)
    expect(h.queriesStore.purgeAccount).toHaveBeenCalledWith(key)
    // テーマは適用キャッシュ (内部 ID) も捨てるので 2 引数
    expect(h.themeStore.purgeAccount).toHaveBeenCalledWith(key, acc.id)
  })

  it('backend 削除が失敗したら何も外さない', async () => {
    h.accountsStore.removeAccount.mockRejectedValueOnce(new Error('boom'))
    const actions = useAccountActions()
    await actions.deleteAccountData(acc)
    expect(h.pluginsStore.purgeAccount).not.toHaveBeenCalled()
    expect(h.queriesStore.purgeAccount).not.toHaveBeenCalled()
    expect(h.themeStore.purgeAccount).not.toHaveBeenCalled()
  })
})

describe('アカウント削除で Secret Vault のアカウント専用接続を消す (#1121)', () => {
  it('backend 削除が成功したら内部 ID で Vault の purge を呼ぶ', async () => {
    const actions = useAccountActions()
    await actions.deleteAccountData(acc)
    expect(h.vault.purgeAccount).toHaveBeenCalledWith(acc.id)
  })

  it('backend 削除が失敗したら Vault に触らない', async () => {
    h.accountsStore.removeAccount.mockRejectedValueOnce(new Error('boom'))
    const actions = useAccountActions()
    await actions.deleteAccountData(acc)
    expect(h.vault.purgeAccount).not.toHaveBeenCalled()
  })

  it('Vault の purge に失敗しても例外にせず警告を出す (アカウント本体は消えている)', async () => {
    h.vault.purgeAccount.mockRejectedValueOnce(new Error('keychain locked'))
    const actions = useAccountActions()
    await expect(actions.deleteAccountData(acc)).resolves.toBeUndefined()
    expect(h.toast.show).toHaveBeenCalledWith(
      expect.stringContaining('keychain locked'),
      'warning',
    )
  })
})

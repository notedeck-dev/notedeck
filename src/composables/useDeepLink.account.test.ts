import { beforeEach, describe, expect, it, vi } from 'vitest'

// アカウント付きルート (notedeck://<host>/...) の口座の解決 (#330 §3.4)。
// 同じホストに複数の口座があるとき、`?account=<Misskey ユーザー ID>` で口座を指定できる。
// 指定が実在しなければ開かない (先頭の口座で開くと別口座から返信する事故になる)。
// 指定が無い既存のリンク (コマンドパレット / AI 生成) は従来どおり先頭の口座。

const { accounts, openWindow, openChatWith, addColumn, toastShow, apiGetUser } =
  vi.hoisted(() => ({
    accounts: [
      { id: 'acc-a', host: 'example.com', userId: 'u-a', hasToken: true },
      { id: 'acc-b', host: 'example.com', userId: 'u-b', hasToken: true },
      { id: 'acc-c', host: 'example.com', userId: 'u-c', hasToken: false },
    ],
    openWindow: vi.fn(),
    openChatWith: vi.fn(),
    addColumn: vi.fn(),
    toastShow: vi.fn(),
    apiGetUser: vi.fn((_accountId: string, _userId: string) =>
      Promise.resolve({
        status: 'ok' as const,
        data: {
          id: 'u-other',
          username: 'other',
          name: 'Other',
          avatarUrl: 'https://x/a.png',
        },
      }),
    ),
  }))

vi.mock('@/stores/accounts', () => ({
  useAccountsStore: () => ({ accounts }),
}))
vi.mock('@/stores/windows', () => ({
  useWindowsStore: () => ({ open: openWindow }),
}))
vi.mock('@/stores/deck', () => ({
  useDeckStore: () => ({
    columns: [],
    getColumn: () => undefined,
    addColumn,
    updateColumn: vi.fn(),
    setActiveColumn: vi.fn(),
    applyProfile: vi.fn(),
    openChatWith,
  }),
}))
vi.mock('@/stores/toast', () => ({
  useToast: () => ({ show: toastShow }),
}))
vi.mock('@/stores/ui', () => ({
  useUiStore: () => ({ requestCompose: vi.fn() }),
}))
vi.mock('@/stores/deckProfile', () => ({
  useDeckProfileStore: () => ({ getProfiles: () => [] }),
}))
vi.mock('@/stores/misstore', () => ({ useMisStoreStore: () => ({}) }))
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}))
vi.mock('@/composables/useMemos', () => ({
  saveMemo: vi.fn(),
  ensureMemosLoaded: vi.fn(),
  generateMemoKey: () => 'k',
}))
vi.mock('@/bindings', () => ({ commands: { apiGetUser } }))

import { handleDeepLink } from '@/composables/useDeepLink'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notedeck://<host>/note/<id>?account=', () => {
  it('account 指定があればその口座で開く', async () => {
    await handleDeepLink('notedeck://example.com/note/n1?account=u-b')
    expect(openWindow).toHaveBeenCalledWith('note-detail', {
      accountId: 'acc-b',
      noteId: 'n1',
    })
  })

  it('account 指定が無ければ従来どおり先頭の口座で開く', async () => {
    await handleDeepLink('notedeck://example.com/note/n1')
    expect(openWindow).toHaveBeenCalledWith('note-detail', {
      accountId: 'acc-a',
      noteId: 'n1',
    })
  })

  it('account 指定が実在しない / トークンが無い / 空なら開かず知らせる', async () => {
    await handleDeepLink('notedeck://example.com/note/n1?account=u-none')
    await handleDeepLink('notedeck://example.com/note/n1?account=u-c')
    await handleDeepLink('notedeck://example.com/note/n1?account=')
    expect(openWindow).not.toHaveBeenCalled()
    expect(toastShow).toHaveBeenCalledTimes(3)
  })
})

describe('notedeck://<host>/chat/user/<id>', () => {
  it('相手を引いてからその口座の会話を開く', async () => {
    await handleDeepLink('notedeck://example.com/chat/user/u-other?account=u-b')
    expect(apiGetUser).toHaveBeenCalledWith('acc-b', 'u-other')
    expect(openChatWith).toHaveBeenCalledWith({
      accountId: 'acc-b',
      userId: 'u-other',
      name: 'Other',
      avatarUrl: 'https://x/a.png',
      serverHost: 'example.com',
    })
  })

  it('相手を引けなくても ID を名前にして開く', async () => {
    apiGetUser.mockResolvedValueOnce({
      status: 'error' as never,
      data: undefined as never,
    })
    await handleDeepLink('notedeck://example.com/chat/user/u-other')
    expect(openChatWith).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-a',
        userId: 'u-other',
        name: 'u-other',
      }),
    )
  })

  it('ルームはまだ会話単位で開けないのでメッセージのカラムを開く', async () => {
    await handleDeepLink('notedeck://example.com/chat/room/r1')
    expect(addColumn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chat', accountId: 'acc-a' }),
    )
  })
})

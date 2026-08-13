import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmOptions } from '@/stores/confirm'

const confirmWithAction =
  vi.fn<(opts: ConfirmOptions) => Promise<string | null>>()

vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirmWithAction }),
}))

import { useAccountPicker } from '@/composables/useAccountPicker'
import { type Account, useAccountsStore } from '@/stores/accounts'

function makeAccount(part: Partial<Account>): Account {
  return {
    id: 'a1',
    host: 'example.com',
    userId: 'u1',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    software: 'misskey',
    hasToken: true,
    ...part,
  } as Account
}

function setAccounts(accounts: Account[]) {
  useAccountsStore().accounts = accounts
}

describe('useAccountPicker — 全アカウントカラムからの操作先 (#1018)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    confirmWithAction.mockReset()
  })

  it('候補が無ければダイアログを出さずに null', async () => {
    setAccounts([])
    const { pickAccount } = useAccountPicker()

    expect(await pickAccount('テスト')).toBeNull()
    expect(confirmWithAction).not.toHaveBeenCalled()
  })

  it('候補が 1 つなら選ぶ余地がないのでダイアログを出さない', async () => {
    setAccounts([makeAccount({ id: 'only' })])
    const { pickAccount } = useAccountPicker()

    expect(await pickAccount('テスト')).toBe('only')
    expect(confirmWithAction).not.toHaveBeenCalled()
  })

  it('複数なら選ばせて、選ばれたアカウントを返す', async () => {
    setAccounts([
      makeAccount({ id: 'a1' }),
      makeAccount({ id: 'a2', host: 'other.example', username: 'bob' }),
    ])
    confirmWithAction.mockResolvedValue('a2')
    const { pickAccount } = useAccountPicker()

    expect(await pickAccount('どのアカウントで？')).toBe('a2')
    const opts = confirmWithAction.mock.calls[0]?.[0]
    expect(opts?.message).toBe('どのアカウントで？')
    expect(opts?.actions?.map((a) => a.value)).toEqual(['a1', 'a2', '__cancel'])
  })

  it('キャンセルなら null', async () => {
    setAccounts([makeAccount({ id: 'a1' }), makeAccount({ id: 'a2' })])
    confirmWithAction.mockResolvedValue('__cancel')
    const { pickAccount } = useAccountPicker()

    expect(await pickAccount('テスト')).toBeNull()
  })

  it('トークンを持たないアカウント (未ログイン・ゲスト) は候補に出さない', async () => {
    setAccounts([
      makeAccount({ id: 'valid' }),
      makeAccount({ id: 'no-token', hasToken: false }),
      makeAccount({ id: 'guest', userId: '__guest__', hasToken: false }),
    ])
    const { pickAccount } = useAccountPicker()

    // 候補が valid の 1 件だけに絞られるのでダイアログは出ない
    expect(await pickAccount('テスト')).toBe('valid')
    expect(confirmWithAction).not.toHaveBeenCalled()
  })
})

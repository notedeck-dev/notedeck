import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { QuickPickStep } from '@/commands/quickPick'
import type { ConfirmOptions } from '@/stores/confirm'

const confirmWithAction =
  vi.fn<(opts: ConfirmOptions) => Promise<string | null>>()

vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirmWithAction }),
}))

const isCompact = ref(false)
vi.mock('@/stores/ui', () => ({
  useIsCompactLayout: () => isCompact,
}))

const paletteOpen = ref(false)
let lastStep: QuickPickStep | null = null
vi.mock('@/commands/registry', () => ({
  useCommandStore: () => ({
    open: () => {
      paletteOpen.value = true
    },
    close: () => {
      paletteOpen.value = false
    },
    pushQuickPick: (step: QuickPickStep) => {
      lastStep = step
    },
    get isOpen() {
      return paletteOpen.value
    },
  }),
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

const TWO = [
  makeAccount({ id: 'a1' }),
  makeAccount({ id: 'a2', host: 'other.example', username: 'bob' }),
]

describe('useAccountPicker — 全アカウントカラムからの操作先 (#1018)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    confirmWithAction.mockReset()
    isCompact.value = false
    paletteOpen.value = false
    lastStep = null
  })

  it('候補が無ければ何も出さずに null', async () => {
    setAccounts([])
    const { pickAccount } = useAccountPicker()

    expect(await pickAccount('テスト')).toBeNull()
    expect(confirmWithAction).not.toHaveBeenCalled()
    expect(lastStep).toBeNull()
  })

  it('候補が 1 つなら選ぶ余地がないので何も出さない', async () => {
    setAccounts([makeAccount({ id: 'only' })])
    const { pickAccount } = useAccountPicker()

    expect(await pickAccount('テスト')).toBe('only')
    expect(confirmWithAction).not.toHaveBeenCalled()
    expect(lastStep).toBeNull()
  })

  it('トークンを持たないアカウント (未ログイン・ゲスト) は候補に出さない', async () => {
    setAccounts([
      makeAccount({ id: 'valid' }),
      makeAccount({ id: 'no-token', hasToken: false }),
      makeAccount({ id: 'guest', userId: '__guest__', hasToken: false }),
    ])
    const { pickAccount } = useAccountPicker()

    // 候補が valid の 1 件だけに絞られるので選択 UI は出ない
    expect(await pickAccount('テスト')).toBe('valid')
    expect(lastStep).toBeNull()
  })

  describe('デスクトップ — コマンドパレットで選ぶ', () => {
    it('選んだアカウントを返す', async () => {
      setAccounts(TWO)
      const { pickAccount } = useAccountPicker()

      const picked = pickAccount('どのアカウントで？')
      await nextTick()

      expect(paletteOpen.value).toBe(true)
      expect(confirmWithAction).not.toHaveBeenCalled()
      expect(lastStep?.placeholder).toBe('どのアカウントで？')
      // アバターとサーバーバッジの材料が渡っている
      expect(lastStep?.items.map((i) => i.serverHost)).toEqual([
        'example.com',
        'other.example',
      ])

      lastStep?.items[1]?.action?.()
      expect(await picked).toBe('a2')
    })

    it('選ばずにパレットを閉じたら null', async () => {
      setAccounts(TWO)
      const { pickAccount } = useAccountPicker()

      const picked = pickAccount('テスト')
      await nextTick()
      paletteOpen.value = false

      expect(await picked).toBeNull()
    })
  })

  describe('コンパクト表示 — ダイアログで選ぶ', () => {
    beforeEach(() => {
      isCompact.value = true
    })

    it('アバター付きの選択肢を出し、選ばれたアカウントを返す', async () => {
      setAccounts(TWO)
      confirmWithAction.mockResolvedValue('a2')
      const { pickAccount } = useAccountPicker()

      expect(await pickAccount('どのアカウントで？')).toBe('a2')
      expect(lastStep).toBeNull()

      const actions = confirmWithAction.mock.calls[0]?.[0]?.actions
      expect(actions?.map((a) => a.value)).toEqual(['a1', 'a2', '__cancel'])
      expect(actions?.[0]?.avatar?.host).toBe('example.com')
      expect(actions?.[0]?.description).toBe('example.com')
    })

    it('キャンセルなら null', async () => {
      setAccounts(TWO)
      confirmWithAction.mockResolvedValue('__cancel')
      const { pickAccount } = useAccountPicker()

      expect(await pickAccount('テスト')).toBeNull()
    })
  })
})

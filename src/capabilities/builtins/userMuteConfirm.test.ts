import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityContext } from '@/capabilities/types'
import { useAccountsStore } from '@/stores/accounts'

const getUser = vi.fn()
vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async () => ({ adapter: { api: { getUser } } })),
}))

import {
  userMuteCapability,
  userRenoteMuteCapability,
  userUnmuteCapability,
  userUnrenoteMuteCapability,
} from './user'

const ctx = {
  accountId: 'a',
  principal: 'ai.chat',
} as unknown as CapabilityContext

async function confirmMessage(
  cap: typeof userMuteCapability,
  params: Record<string, unknown>,
): Promise<string> {
  if (typeof cap.requiresConfirmation !== 'function') {
    throw new Error('confirmation not found')
  }
  const opts = await cap.requiresConfirmation(params, ctx)
  if (!opts) throw new Error('confirmation returned null')
  return opts.message
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAccountsStore().accounts = [
    {
      id: 'a',
      host: 'example.test',
      userId: 'me',
      username: 'me',
      displayName: null,
      avatarUrl: null,
      software: 'misskey-dev/misskey',
      hasToken: true,
    },
  ]
  getUser.mockReset()
})

/** 承認する人が誰をミュートするのか読めること (#1358) */
describe('AI 経路のミュート操作の確認に相手の名前を出す', () => {
  it('表示名と acct を出し、内部の ID は出さない', async () => {
    getUser.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      host: 'remote.test',
      name: 'Alice',
    })
    const msg = await confirmMessage(userMuteCapability, { userId: 'u1' })
    expect(getUser).toHaveBeenCalledWith('u1')
    expect(msg).toContain('Alice (@alice@remote.test)')
    expect(msg).not.toContain('u1')
  })

  it('ローカルユーザーはアカウントのサーバーを補い、表示名が無ければ acct だけ', async () => {
    getUser.mockResolvedValue({
      id: 'u2',
      username: 'bob',
      host: null,
      name: null,
    })
    const msg = await confirmMessage(userMuteCapability, { userId: 'u2' })
    expect(msg.startsWith('@bob@example.test ')).toBe(true)
  })

  it('相手を引けなければ ID を出す', async () => {
    getUser.mockRejectedValue(new Error('no such user'))
    const msg = await confirmMessage(userMuteCapability, { userId: 'u3' })
    expect(msg).toContain('userId `u3`')
  })

  it('解除・リノートミュート・その解除も同じ', async () => {
    getUser.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      host: 'remote.test',
      name: 'Alice',
    })
    for (const cap of [
      userUnmuteCapability,
      userRenoteMuteCapability,
      userUnrenoteMuteCapability,
    ]) {
      const msg = await confirmMessage(cap, { userId: 'u1' })
      expect(msg).toContain('Alice (@alice@remote.test)')
    }
  })
})

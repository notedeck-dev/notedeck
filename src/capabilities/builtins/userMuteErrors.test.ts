import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountsStore } from '@/stores/accounts'
import { useMutesStore } from '@/stores/mutes'
import { AppError } from '@/utils/errors'

const muteUser = vi.fn()
const unmuteUser = vi.fn()
vi.mock('@/adapters/factory', () => ({
  initAdapterFor: vi.fn(async () => ({
    adapter: { api: { muteUser, unmuteUser } },
  })),
}))

import { userMuteCapability, userUnmuteCapability } from './user'

const ctx = { accountId: 'a', principal: 'ai.chat' } as unknown as Parameters<
  typeof userMuteCapability.execute
>[1]

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
  muteUser.mockReset()
  unmuteUser.mockReset()
})

describe('AI 経路のミュート操作の失敗系 (#1260)', () => {
  it('user.mute: サーバーが ALREADY_MUTING を返したら手元もミュート中にして成功', async () => {
    muteUser.mockRejectedValue(
      new AppError('API', 'already muting', 'ALREADY_MUTING'),
    )
    const r = await userMuteCapability.execute({ userId: 'u1' }, ctx)
    expect(r).toEqual({ muted: true, userId: 'u1', alreadyMuted: true })
    expect(useMutesStore().isUserMuted('a', 'u1')).toBe(true)
  })

  it('user.mute: 他のエラーはそのまま投げる', async () => {
    muteUser.mockRejectedValue(
      new AppError('API', 'rate limited', 'RATE_LIMIT_EXCEEDED'),
    )
    await expect(
      userMuteCapability.execute({ userId: 'u1' }, ctx),
    ).rejects.toMatchObject({ apiCode: 'RATE_LIMIT_EXCEEDED' })
    expect(useMutesStore().isUserMuted('a', 'u1')).toBe(false)
  })

  it('user.unmute: サーバーが NOT_MUTING を返したら解除済みとして成功', async () => {
    useMutesStore().muteUser('a', 'u1')
    unmuteUser.mockRejectedValue(
      new AppError('API', 'not muting', 'NOT_MUTING'),
    )
    const r = await userUnmuteCapability.execute({ userId: 'u1' }, ctx)
    expect(r).toEqual({ unmuted: true, userId: 'u1', alreadyUnmuted: true })
    expect(useMutesStore().isUserMuted('a', 'u1')).toBe(false)
  })
})
